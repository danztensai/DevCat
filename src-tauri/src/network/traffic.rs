//! Live traffic counters for network profiles.
//!
//! Sources keep cumulative byte totals per profile:
//! - OpenVPN: `>BYTECOUNT:in,out` from the management interface (`bytecount 1`)
//! - SSH tunnels: bytes counted as they are copied through the forwards
//! - WireGuard: the tunnel interface's kernel counters, polled every second
//!
//! A sampler turns totals into rates once a second, keeps the last `HISTORY` samples
//! per profile and emits `net-traffic` events (`TrafficSample`) for connected profiles.
use super::registry;
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use serde::Serialize;
use std::collections::{HashMap, VecDeque};
use std::time::Duration;
use tauri::Emitter;

/// Samples kept per profile (1/s → 5 minutes).
pub const HISTORY: usize = 300;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TrafficSample {
    pub id: String,
    /// Unix time in milliseconds.
    pub at: i64,
    /// Bytes per second received (download) / sent (upload) over the last interval.
    pub rx_rate: f64,
    pub tx_rate: f64,
    /// Totals since the connection started.
    pub rx_total: u64,
    pub tx_total: u64,
}

#[derive(Default)]
struct Counter {
    rx: u64,
    tx: u64,
    /// Interface to poll (WireGuard).
    iface: Option<String>,
    /// Interface counters at connect time, so totals start at 0.
    iface_base: Option<(u64, u64)>,
    /// Totals at the previous sample.
    last: Option<(u64, u64, i64)>,
    history: VecDeque<TrafficSample>,
}

static COUNTERS: Lazy<Mutex<HashMap<String, Counter>>> = Lazy::new(Default::default);

/// Start counting from zero (called when a connection attempt begins).
pub fn reset(id: &str) {
    COUNTERS.lock().insert(id.to_string(), Counter::default());
}

/// Forget a profile (deleted).
pub fn remove(id: &str) {
    COUNTERS.lock().remove(id);
}

/// Set cumulative totals reported by the source (OpenVPN).
pub fn set_totals(id: &str, rx: u64, tx: u64) {
    let mut c = COUNTERS.lock();
    let e = c.entry(id.to_string()).or_default();
    e.rx = rx;
    e.tx = tx;
}

/// Add bytes (SSH tunnels).
pub fn add(id: &str, rx: u64, tx: u64) {
    if rx == 0 && tx == 0 {
        return;
    }
    let mut c = COUNTERS.lock();
    let e = c.entry(id.to_string()).or_default();
    e.rx += rx;
    e.tx += tx;
}

/// Poll this interface's kernel counters (WireGuard).
pub fn watch_interface(id: &str, iface: &str) {
    let base = iface_counters(iface);
    let mut c = COUNTERS.lock();
    let e = c.entry(id.to_string()).or_default();
    e.iface = Some(iface.to_string());
    e.iface_base = base;
}

/// History for a profile, oldest first.
pub fn history(id: &str) -> Vec<TrafficSample> {
    COUNTERS.lock().get(id).map(|c| c.history.iter().cloned().collect()).unwrap_or_default()
}

/// Turn the current totals into a sample. Pure function of the counter, for tests.
fn sample(id: &str, c: &mut Counter, now_ms: i64) -> Option<TrafficSample> {
    let (rx, tx) = (c.rx, c.tx);
    let s = match c.last {
        None => TrafficSample { id: id.into(), at: now_ms, rx_rate: 0.0, tx_rate: 0.0, rx_total: rx, tx_total: tx },
        Some((lrx, ltx, lat)) => {
            let secs = ((now_ms - lat) as f64 / 1000.0).max(0.001);
            TrafficSample {
                id: id.into(),
                at: now_ms,
                // Counters can go backwards if the source restarted (OpenVPN reconnect).
                rx_rate: rx.saturating_sub(lrx) as f64 / secs,
                tx_rate: tx.saturating_sub(ltx) as f64 / secs,
                rx_total: rx,
                tx_total: tx,
            }
        }
    };
    c.last = Some((rx, tx, now_ms));
    if c.history.len() >= HISTORY {
        c.history.pop_front();
    }
    c.history.push_back(s.clone());
    Some(s)
}

/// Sample every connected profile once a second and emit `net-traffic`.
pub fn spawn_sampler() {
    tauri::async_runtime::spawn(async {
        let mut tick = tokio::time::interval(Duration::from_secs(1));
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            tick.tick().await;
            let statuses = registry::statuses();
            let now_ms = chrono::Utc::now().timestamp_millis();
            let mut out = Vec::new();
            {
                // Poll interfaces outside the main lock.
                let polls: Vec<(String, String)> = COUNTERS
                    .lock()
                    .iter()
                    .filter_map(|(id, c)| c.iface.clone().map(|i| (id.clone(), i)))
                    .collect();
                let readings: Vec<(String, Option<(u64, u64)>)> =
                    polls.into_iter().map(|(id, iface)| (id, iface_counters(&iface))).collect();
                let mut c = COUNTERS.lock();
                for (id, reading) in readings {
                    if let (Some(e), Some((rx, tx))) = (c.get_mut(&id), reading) {
                        let (brx, btx) = e.iface_base.unwrap_or((0, 0));
                        e.rx = rx.saturating_sub(brx);
                        e.tx = tx.saturating_sub(btx);
                    }
                }
                for (id, e) in c.iter_mut() {
                    if statuses.get(id).is_some_and(|s| s.state == registry::CONNECTED) {
                        if let Some(s) = sample(id, e, now_ms) {
                            out.push(s);
                        }
                    }
                }
            }
            if let Some(app) = registry::APP.get() {
                for s in out {
                    let _ = app.emit("net-traffic", &s);
                }
            }
        }
    });
}

/// (rx_bytes, tx_bytes) of a network interface, without elevated rights.
#[cfg(target_os = "linux")]
pub fn iface_counters(iface: &str) -> Option<(u64, u64)> {
    let read = |f: &str| std::fs::read_to_string(format!("/sys/class/net/{iface}/statistics/{f}")).ok()?.trim().parse().ok();
    Some((read("rx_bytes")?, read("tx_bytes")?))
}

#[cfg(target_os = "macos")]
pub fn iface_counters(iface: &str) -> Option<(u64, u64)> {
    use std::ffi::CStr;
    // SAFETY: standard getifaddrs/freeifaddrs usage; we only read entries while the list is alive.
    unsafe {
        let mut list: *mut libc::ifaddrs = std::ptr::null_mut();
        if libc::getifaddrs(&mut list) != 0 {
            return None;
        }
        let mut found = None;
        let mut cur = list;
        while !cur.is_null() {
            let ifa = &*cur;
            if !ifa.ifa_addr.is_null()
                && (*ifa.ifa_addr).sa_family as i32 == libc::AF_LINK
                && !ifa.ifa_data.is_null()
                && CStr::from_ptr(ifa.ifa_name).to_str().ok() == Some(iface)
            {
                let data = &*(ifa.ifa_data as *const libc::if_data);
                found = Some((data.ifi_ibytes as u64, data.ifi_obytes as u64));
                break;
            }
            cur = ifa.ifa_next;
        }
        libc::freeifaddrs(list);
        found
    }
}

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
pub fn iface_counters(_iface: &str) -> Option<(u64, u64)> {
    None
}

// ---- counting wrapper for SSH tunnel streams

use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll};
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};

/// Wraps the local (client-side) socket of a forward: bytes read from it are
/// uploaded (tx), bytes written to it were downloaded (rx).
pub struct Counted<S> {
    inner: S,
    id: Arc<str>,
}

impl<S> Counted<S> {
    pub fn new(inner: S, id: &str) -> Self {
        Self { inner, id: Arc::from(id) }
    }
}

impl<S: AsyncRead + Unpin> AsyncRead for Counted<S> {
    fn poll_read(mut self: Pin<&mut Self>, cx: &mut Context<'_>, buf: &mut ReadBuf<'_>) -> Poll<std::io::Result<()>> {
        let before = buf.filled().len();
        let r = Pin::new(&mut self.inner).poll_read(cx, buf);
        if let Poll::Ready(Ok(())) = r {
            add(&self.id, 0, (buf.filled().len() - before) as u64);
        }
        r
    }
}

impl<S: AsyncWrite + Unpin> AsyncWrite for Counted<S> {
    fn poll_write(mut self: Pin<&mut Self>, cx: &mut Context<'_>, data: &[u8]) -> Poll<std::io::Result<usize>> {
        let r = Pin::new(&mut self.inner).poll_write(cx, data);
        if let Poll::Ready(Ok(n)) = r {
            add(&self.id, n as u64, 0);
        }
        r
    }
    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        Pin::new(&mut self.inner).poll_flush(cx)
    }
    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        Pin::new(&mut self.inner).poll_shutdown(cx)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    #[test]
    fn rates_from_totals() {
        let mut c = Counter::default();
        let s0 = sample("t", &mut c, 1_000).unwrap();
        assert_eq!((s0.rx_rate, s0.tx_rate), (0.0, 0.0));
        c.rx = 2048;
        c.tx = 512;
        let s1 = sample("t", &mut c, 3_000).unwrap();
        assert_eq!((s1.rx_rate, s1.tx_rate), (1024.0, 256.0));
        assert_eq!((s1.rx_total, s1.tx_total), (2048, 512));
        // Source restarted: no negative rates.
        c.rx = 10;
        let s2 = sample("t", &mut c, 4_000).unwrap();
        assert_eq!(s2.rx_rate, 0.0);
        for i in 0..(HISTORY + 10) {
            sample("t", &mut c, 5_000 + i as i64 * 1000);
        }
        assert_eq!(c.history.len(), HISTORY);
    }

    #[tokio::test]
    async fn counted_stream_counts_both_ways() {
        let id = "traffic-test-counted";
        reset(id);
        let (a, mut b) = tokio::io::duplex(64);
        let mut wrapped = Counted::new(a, id);
        wrapped.write_all(b"hello").await.unwrap(); // to the local client = downloaded
        let mut buf = [0u8; 5];
        b.read_exact(&mut buf).await.unwrap();
        b.write_all(b"abc").await.unwrap(); // from the local client = uploaded
        let mut got = [0u8; 3];
        wrapped.read_exact(&mut got).await.unwrap();
        let c = COUNTERS.lock();
        let e = c.get(id).unwrap();
        assert_eq!((e.rx, e.tx), (5, 3));
        drop(c);
        remove(id);
    }

    #[test]
    fn loopback_counters_readable() {
        // lo0 on macOS, lo on Linux; just make sure the read path works where supported.
        if cfg!(any(target_os = "macos", target_os = "linux")) {
            let name = if cfg!(target_os = "macos") { "lo0" } else { "lo" };
            assert!(iface_counters(name).is_some(), "could not read {name} counters");
        }
    }
}
