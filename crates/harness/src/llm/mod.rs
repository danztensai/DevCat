//! Model providers. [`Llm::step`] sends the conversation and streams one assistant message back;
//! each wire protocol has its own small adapter.
mod anthropic;
mod openai;
mod sse;

use crate::message::{Block, Message, ToolSpec, Usage};
use crate::{Error, Result};
use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Protocol {
    /// Anthropic Messages API (`/v1/messages`).
    Anthropic,
    /// OpenAI-compatible Chat Completions (`/chat/completions`): OpenAI, DeepSeek, Kimi, GLM,
    /// OpenRouter, Ollama, LM Studio, vLLM and most gateways.
    OpenaiChat,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmConfig {
    pub protocol: Protocol,
    /// API root, e.g. `https://api.anthropic.com`, `https://api.openai.com/v1`,
    /// `http://127.0.0.1:11434/v1` (Ollama).
    pub base_url: String,
    #[serde(default, skip_serializing)]
    pub api_key: Option<String>,
    pub model: String,
    #[serde(default = "default_max_tokens")]
    pub max_tokens: u32,
}

fn default_max_tokens() -> u32 {
    8192
}

/// What one model call needs.
pub struct Request<'a> {
    pub system: &'a str,
    pub messages: &'a [Message],
    pub tools: &'a [ToolSpec],
}

/// Pieces of the answer as they arrive, for live display.
#[derive(Debug, Clone, PartialEq)]
pub enum Delta {
    Text(String),
    Thinking(String),
    /// The model started a tool call (its input is still streaming).
    ToolStart { id: String, name: String },
}

/// The finished assistant message of one step.
#[derive(Debug, Clone, PartialEq)]
pub struct Reply {
    pub content: Vec<Block>,
    pub usage: Usage,
    /// The model stopped because it hit `max_tokens`.
    pub truncated: bool,
}

pub struct Llm {
    pub config: LlmConfig,
    http: reqwest::Client,
}

/// Retries for overloaded / rate-limited / flaky providers, before anything was streamed.
const RETRIES: u32 = 3;

impl Llm {
    pub fn new(config: LlmConfig) -> Llm {
        let http = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(20))
            // a stalled stream: no bytes for this long
            .read_timeout(Duration::from_secs(300))
            .build()
            .unwrap_or_default();
        Llm { config, http }
    }

    /// Run one model step, calling `on` for every streamed piece.
    pub async fn step(&self, req: &Request<'_>, on: &mut (dyn FnMut(Delta) + Send)) -> Result<Reply> {
        let mut attempt = 0;
        loop {
            let res = match self.config.protocol {
                Protocol::Anthropic => anthropic::send(&self.http, &self.config, req).await,
                Protocol::OpenaiChat => openai::send(&self.http, &self.config, req).await,
            };
            match res {
                Ok(resp) => {
                    return match self.config.protocol {
                        Protocol::Anthropic => anthropic::read(resp, on).await,
                        Protocol::OpenaiChat => openai::read(resp, on).await,
                    };
                }
                Err(Retry::Later(e, wait)) if attempt < RETRIES => {
                    attempt += 1;
                    tokio::time::sleep(wait.unwrap_or(Duration::from_secs(2u64.pow(attempt)))).await;
                    let _ = e;
                }
                Err(Retry::Later(e, _)) | Err(Retry::Never(e)) => return Err(e),
            }
        }
    }
}

/// Why a request failed, and whether trying again can help.
pub(crate) enum Retry {
    Later(Error, Option<Duration>),
    Never(Error),
}

/// Turn a non-2xx response into an error with the provider's message.
pub(crate) async fn http_error(resp: reqwest::Response) -> Retry {
    let status = resp.status();
    let wait = resp
        .headers()
        .get("retry-after")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<u64>().ok())
        .map(|s| Duration::from_secs(s.min(60)));
    let body = resp.text().await.unwrap_or_default();
    let msg = serde_json::from_str::<serde_json::Value>(&body)
        .ok()
        .and_then(|v| v.pointer("/error/message").and_then(|m| m.as_str()).map(String::from))
        .unwrap_or_else(|| body.chars().take(500).collect());
    let e = Error::Provider(format!("{} {}", status.as_u16(), msg.trim()));
    if status.as_u16() == 429 || status.as_u16() == 529 || status.is_server_error() { Retry::Later(e, wait) } else { Retry::Never(e) }
}

pub(crate) fn transport(e: reqwest::Error) -> Retry {
    if e.is_connect() || e.is_timeout() { Retry::Later(e.into(), None) } else { Retry::Never(e.into()) }
}

/// `base_url` + `path`, without doubling the slash.
pub(crate) fn url(base: &str, path: &str) -> String {
    format!("{}/{}", base.trim_end_matches('/'), path.trim_start_matches('/'))
}
