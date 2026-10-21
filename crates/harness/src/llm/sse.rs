//! Server-sent events over a streamed HTTP body: yields the `data:` payload of each event.
//! Works on bytes until an event is complete, so a UTF-8 character split across network chunks
//! stays intact.
use crate::Result;
use futures::StreamExt;
use futures::stream::BoxStream;

pub(crate) struct Sse {
    body: BoxStream<'static, reqwest::Result<bytes::Bytes>>,
    buf: Vec<u8>,
    done: bool,
}

impl Sse {
    pub fn new(resp: reqwest::Response) -> Sse {
        Sse { body: resp.bytes_stream().boxed(), buf: Vec::new(), done: false }
    }

    /// The next event's data (several `data:` lines joined with `\n`), or None at the end.
    pub async fn next(&mut self) -> Result<Option<String>> {
        loop {
            if let Some(ev) = take_event(&mut self.buf) {
                match ev {
                    Some(data) => return Ok(Some(data)),
                    None => continue,
                }
            }
            if self.done {
                // a last event without the blank line after it
                let rest = std::mem::take(&mut self.buf);
                return Ok(parse_event(&String::from_utf8_lossy(&rest)));
            }
            match self.body.next().await {
                // CR is never part of a multi-byte UTF-8 character, so dropping it is safe.
                Some(chunk) => self.buf.extend(chunk?.iter().filter(|b| **b != b'\r')),
                None => self.done = true,
            }
        }
    }
}

/// Split one complete event (ending in a blank line) off the buffer (CRs already removed).
/// `Some(None)` is an event without data (a comment / keep-alive).
fn take_event(buf: &mut Vec<u8>) -> Option<Option<String>> {
    let end = buf.windows(2).position(|w| w == b"\n\n")?;
    let ev: Vec<u8> = buf.drain(..end + 2).collect();
    Some(parse_event(&String::from_utf8_lossy(&ev[..end])))
}

fn parse_event(ev: &str) -> Option<String> {
    let data: Vec<&str> = ev
        .lines()
        .filter_map(|l| l.strip_prefix("data:"))
        .map(|d| d.strip_prefix(' ').unwrap_or(d))
        .collect();
    (!data.is_empty()).then(|| data.join("\n"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_events_and_skips_comments() {
        let raw = ": ping\r\n\r\nevent: x\r\ndata: {\"a\":1}\r\n\r\ndata: one\ndata: two\n\ndata: part";
        let mut buf: Vec<u8> = raw.bytes().filter(|b| *b != b'\r').collect();
        assert_eq!(take_event(&mut buf), Some(None));
        assert_eq!(take_event(&mut buf), Some(Some("{\"a\":1}".into())));
        assert_eq!(take_event(&mut buf), Some(Some("one\ntwo".into())));
        assert_eq!(take_event(&mut buf), None);
        assert_eq!(buf, b"data: part");
    }

    #[test]
    fn keeps_a_character_split_across_chunks() {
        let text = "data: héllo ✓\n\n".as_bytes();
        let cut = text.iter().position(|b| *b == 0xE2).unwrap() + 1; // inside "✓"
        let mut buf = text[..cut].to_vec();
        assert_eq!(take_event(&mut buf), None);
        buf.extend_from_slice(&text[cut..]);
        assert_eq!(take_event(&mut buf), Some(Some("héllo ✓".into())));
    }
}
