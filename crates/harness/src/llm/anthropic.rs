//! Anthropic Messages API (`POST {base}/v1/messages`, streamed).
use super::sse::Sse;
use super::{Delta, LlmConfig, Reply, Request, Retry, http_error, transport, url};
use crate::message::{Block, Message, Role, Usage};
use crate::{Error, Result};
use serde_json::{Value, json};

const VERSION: &str = "2023-06-01";

pub(super) async fn send(http: &reqwest::Client, cfg: &LlmConfig, req: &Request<'_>) -> std::result::Result<reqwest::Response, Retry> {
    // accept both "https://api.anthropic.com" and ".../v1"
    let path = if cfg.base_url.trim_end_matches('/').ends_with("/v1") { "messages" } else { "v1/messages" };
    let mut b = http.post(url(&cfg.base_url, path)).header("anthropic-version", VERSION).json(&body(cfg, req));
    if let Some(k) = cfg.api_key.as_deref().filter(|k| !k.is_empty()) {
        b = b.header("x-api-key", k);
    }
    let resp = b.send().await.map_err(transport)?;
    if resp.status().is_success() { Ok(resp) } else { Err(http_error(resp).await) }
}

pub(super) fn body(cfg: &LlmConfig, req: &Request<'_>) -> Value {
    let mut b = json!({
        "model": cfg.model,
        "max_tokens": cfg.max_tokens,
        // The system prompt and tools are the same every step: cache them.
        "system": [{ "type": "text", "text": req.system, "cache_control": { "type": "ephemeral" } }],
        "messages": req.messages.iter().map(wire_message).collect::<Vec<_>>(),
        "stream": true,
    });
    if !req.tools.is_empty() {
        b["tools"] = req.tools.iter().map(|t| json!({ "name": t.name, "description": t.description, "input_schema": t.input_schema })).collect();
    }
    b
}

fn wire_message(m: &Message) -> Value {
    let content: Vec<Value> = m
        .content
        .iter()
        .filter_map(|b| match b {
            Block::Text { text } if !text.is_empty() => Some(json!({ "type": "text", "text": text })),
            Block::Text { .. } => None,
            // Thinking goes back only with its signature (Anthropic verifies it).
            Block::Thinking { text, signature: Some(sig) } => Some(json!({ "type": "thinking", "thinking": text, "signature": sig })),
            Block::Thinking { .. } => None,
            Block::ToolUse { id, name, input } => Some(json!({ "type": "tool_use", "id": id, "name": name, "input": input })),
            Block::ToolResult { tool_use_id, content, is_error } => {
                Some(json!({ "type": "tool_result", "tool_use_id": tool_use_id, "content": content, "is_error": is_error }))
            }
        })
        .collect();
    json!({ "role": match m.role { Role::User => "user", Role::Assistant => "assistant" }, "content": content })
}

enum Part {
    Text(String),
    Thinking(String, Option<String>),
    Tool { id: String, name: String, json: String },
}

pub(super) async fn read(resp: reqwest::Response, on: &mut (dyn FnMut(Delta) + Send)) -> Result<Reply> {
    let mut sse = Sse::new(resp);
    let mut parser = Parser::default();
    while let Some(data) = sse.next().await? {
        let v: Value = serde_json::from_str(&data).map_err(|e| Error::Provider(format!("bad stream event: {e}")))?;
        if parser.event(&v, on)? {
            break;
        }
    }
    Ok(parser.finish())
}

#[derive(Default)]
pub(super) struct Parser {
    parts: Vec<(u64, Part)>,
    usage: Usage,
    truncated: bool,
}

impl Parser {
    fn part(&mut self, index: u64) -> Option<&mut Part> {
        self.parts.iter_mut().find(|(i, _)| *i == index).map(|(_, p)| p)
    }

    /// Handle one event; true at the end of the message.
    pub(super) fn event(&mut self, v: &Value, on: &mut (dyn FnMut(Delta) + Send)) -> Result<bool> {
        let s = |p: &str| v.pointer(p).and_then(Value::as_str).unwrap_or_default().to_string();
        let n = |p: &str| v.pointer(p).and_then(Value::as_u64).unwrap_or(0);
        let index = n("/index");
        match v.get("type").and_then(Value::as_str).unwrap_or_default() {
            "message_start" => {
                let read = n("/message/usage/cache_read_input_tokens");
                self.usage.input_tokens = n("/message/usage/input_tokens") + read + n("/message/usage/cache_creation_input_tokens");
                self.usage.cache_read_tokens = read;
                self.usage.output_tokens = n("/message/usage/output_tokens");
            }
            "content_block_start" => {
                let part = match s("/content_block/type").as_str() {
                    "text" => Part::Text(s("/content_block/text")),
                    "thinking" => Part::Thinking(s("/content_block/thinking"), None),
                    "tool_use" => {
                        let (id, name) = (s("/content_block/id"), s("/content_block/name"));
                        on(Delta::ToolStart { id: id.clone(), name: name.clone() });
                        Part::Tool { id, name, json: String::new() }
                    }
                    _ => return Ok(false), // redacted thinking, server tools: not used
                };
                self.parts.push((index, part));
            }
            "content_block_delta" => {
                let kind = s("/delta/type");
                let Some(part) = self.part(index) else { return Ok(false) };
                match (kind.as_str(), part) {
                    ("text_delta", Part::Text(t)) => {
                        let d = s("/delta/text");
                        t.push_str(&d);
                        on(Delta::Text(d));
                    }
                    ("thinking_delta", Part::Thinking(t, _)) => {
                        let d = s("/delta/thinking");
                        t.push_str(&d);
                        on(Delta::Thinking(d));
                    }
                    ("signature_delta", Part::Thinking(_, sig)) => sig.get_or_insert_with(String::new).push_str(&s("/delta/signature")),
                    ("input_json_delta", Part::Tool { json, .. }) => json.push_str(&s("/delta/partial_json")),
                    _ => {}
                }
            }
            "message_delta" => {
                if s("/delta/stop_reason") == "max_tokens" {
                    self.truncated = true;
                }
                if v.pointer("/usage/output_tokens").is_some() {
                    self.usage.output_tokens = n("/usage/output_tokens");
                }
                // Anthropic (newer) and compatible APIs such as Z.ai send the input count here too,
                // sometimes only here (message_start then says 0).
                if n("/usage/input_tokens") > 0 {
                    let read = n("/usage/cache_read_input_tokens");
                    self.usage.input_tokens = n("/usage/input_tokens") + read + n("/usage/cache_creation_input_tokens");
                    self.usage.cache_read_tokens = read;
                }
            }
            "message_stop" => return Ok(true),
            "error" => return Err(Error::Provider(s("/error/message"))),
            _ => {}
        }
        Ok(false)
    }

    pub(super) fn finish(self) -> Reply {
        let content = self
            .parts
            .into_iter()
            .filter_map(|(_, p)| match p {
                Part::Text(t) if !t.trim().is_empty() => Some(Block::Text { text: t }),
                Part::Text(_) => None,
                Part::Thinking(t, sig) => Some(Block::Thinking { text: t, signature: sig }),
                Part::Tool { id, name, json } => {
                    let input = if json.trim().is_empty() { json!({}) } else { serde_json::from_str(&json).unwrap_or_else(|_| json!({ "_unparsed_arguments": json })) };
                    Some(Block::ToolUse { id, name, input })
                }
            })
            .collect();
        Reply { content, usage: self.usage, truncated: self.truncated }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stream_with_thinking_text_and_tool() {
        let events = [
            json!({ "type": "message_start", "message": { "usage": { "input_tokens": 50, "cache_read_input_tokens": 900, "cache_creation_input_tokens": 0, "output_tokens": 1 } } }),
            json!({ "type": "content_block_start", "index": 0, "content_block": { "type": "thinking", "thinking": "" } }),
            json!({ "type": "content_block_delta", "index": 0, "delta": { "type": "thinking_delta", "thinking": "Need the file." } }),
            json!({ "type": "content_block_delta", "index": 0, "delta": { "type": "signature_delta", "signature": "sig==" } }),
            json!({ "type": "content_block_stop", "index": 0 }),
            json!({ "type": "content_block_start", "index": 1, "content_block": { "type": "text", "text": "" } }),
            json!({ "type": "content_block_delta", "index": 1, "delta": { "type": "text_delta", "text": "Reading it." } }),
            json!({ "type": "content_block_start", "index": 2, "content_block": { "type": "tool_use", "id": "toolu_1", "name": "read", "input": {} } }),
            json!({ "type": "content_block_delta", "index": 2, "delta": { "type": "input_json_delta", "partial_json": "{\"path\": \"src/" } }),
            json!({ "type": "content_block_delta", "index": 2, "delta": { "type": "input_json_delta", "partial_json": "main.rs\"}" } }),
            json!({ "type": "message_delta", "delta": { "stop_reason": "tool_use" }, "usage": { "output_tokens": 42 } }),
            json!({ "type": "message_stop" }),
        ];
        let mut p = Parser::default();
        let mut ended = false;
        for e in &events {
            ended = p.event(e, &mut |_| {}).unwrap();
        }
        assert!(ended);
        let r = p.finish();
        assert_eq!(r.content, vec![
            Block::Thinking { text: "Need the file.".into(), signature: Some("sig==".into()) },
            Block::Text { text: "Reading it.".into() },
            Block::ToolUse { id: "toolu_1".into(), name: "read".into(), input: json!({ "path": "src/main.rs" }) },
        ]);
        assert_eq!(r.usage, Usage { input_tokens: 950, output_tokens: 42, cache_read_tokens: 900 });
        assert!(!r.truncated);
    }

    #[test]
    fn input_tokens_reported_at_the_end() {
        let mut p = Parser::default();
        for e in [
            json!({ "type": "message_start", "message": { "usage": { "input_tokens": 0, "output_tokens": 0 } } }),
            json!({ "type": "message_delta", "delta": { "stop_reason": "max_tokens" }, "usage": { "input_tokens": 14, "output_tokens": 20, "cache_read_input_tokens": 6 } }),
        ] {
            p.event(&e, &mut |_| {}).unwrap();
        }
        let r = p.finish();
        assert_eq!(r.usage, Usage { input_tokens: 20, output_tokens: 20, cache_read_tokens: 6 });
        assert!(r.truncated);
    }

    #[test]
    fn request_keeps_signed_thinking_only() {
        let msgs = [Message {
            role: Role::Assistant,
            content: vec![
                Block::Thinking { text: "a".into(), signature: Some("s".into()) },
                Block::Thinking { text: "from another provider".into(), signature: None },
                Block::ToolUse { id: "t".into(), name: "read".into(), input: json!({}) },
            ],
        }];
        let cfg = LlmConfig { protocol: super::super::Protocol::Anthropic, base_url: "x".into(), api_key: None, model: "m".into(), max_tokens: 10 };
        let b = body(&cfg, &Request { system: "s", messages: &msgs, tools: &[] });
        let c = b["messages"][0]["content"].as_array().unwrap();
        assert_eq!(c.len(), 2);
        assert_eq!(c[0]["type"], "thinking");
        assert_eq!(c[1]["type"], "tool_use");
    }
}
