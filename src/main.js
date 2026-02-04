import { Device } from "@twilio/voice-sdk";
import "./style.css";

const CONFIG = {
  tokenEndpoint:
    import.meta.env.VITE_TOKEN_ENDPOINT || "https://twilio-token-6608.twil.io/twilio-token",
  authKey: import.meta.env.VITE_DIALER_AUTH_KEY || "YOUR_KEY_HERE",
};

let device = null;
let call = null;
let deviceInitialized = false;
let isRegistered = false;
let isMuted = false;

let timer = null;
let seconds = 0;

const el = {
  businessName: document.getElementById("businessName"),
  phoneNumber: document.getElementById("phoneNumber"),
  callStatus: document.getElementById("callStatus"),
  callTimer: document.getElementById("callTimer"),
  errorContainer: document.getElementById("errorContainer"),
  callButton: document.getElementById("callButton"),
  muteBtn: document.getElementById("muteBtn"),
};

function params() {
  const p = new URLSearchParams(location.search);
  return { to: p.get("to"), name: p.get("name") || "Unknown Contact" };
}

function showError(title, details) {
  el.errorContainer.innerHTML =
    '<div class="error-message">' +
    '<div class="error-title"></div>' +
    '<div class="error-details"></div>' +
    "</div>";
  el.errorContainer.querySelector(".error-title").textContent = title;
  el.errorContainer.querySelector(".error-details").textContent = details || "";
}

function clearError() {
  el.errorContainer.innerHTML = "";
}

function setStatus(s) {
  el.callStatus.textContent = s;
}

function enableKeypad(on) {
  document.querySelectorAll(".key").forEach((b) => (b.disabled = !on));
}

function startTimer() {
  seconds = 0;
  el.callTimer.classList.remove("hidden");
  timer = setInterval(() => {
    seconds++;
    const m = String(Math.floor(seconds / 60)).padStart(2, "0");
    const s = String(seconds % 60).padStart(2, "0");
    el.callTimer.textContent = `${m}:${s}`;
  }, 1000);
}

function stopTimer() {
  if (timer) clearInterval(timer);
  timer = null;
  el.callTimer.classList.add("hidden");
}

async function requestMic() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    return true;
  } catch (e) {
    showError("Microphone blocked", "Allow microphone access, then click Call again.");
    setStatus("Mic blocked");
    return false;
  }
}

async function initDevice() {
  if (deviceInitialized) return true;

  setStatus("Connecting…");
  clearError();

  const url = `${CONFIG.tokenEndpoint}?key=${encodeURIComponent(CONFIG.authKey)}`;
  const r = await fetch(url, { method: "GET" });

  if (!r.ok) {
    const t = await r.text();
    showError("Token error", `HTTP ${r.status} — ${t}`);
    setStatus("Token error");
    return false;
  }

  const data = await r.json();
  if (!data.token) {
    showError("Token error", "No token returned.");
    setStatus("Token error");
    return false;
  }

  device = new Device(data.token, {
    logLevel: 1,
    codecPreferences: ["opus", "pcmu"],
  });

  device.on("registered", () => {
    isRegistered = true;
    setStatus("Tap to Call");
    el.callButton.disabled = false;
    clearError();
  });

  device.on("unregistered", () => {
    isRegistered = false;
    if (!call) {
      showError("Device offline", "Connection to Twilio lost. Refresh the page.");
      setStatus("Offline");
      el.callButton.disabled = true;
    }
  });

  device.on("error", (err) => {
    showError("Device error", err?.message ? err.message : String(err));
    setStatus("Error");
  });

  await device.register();
  deviceInitialized = true;
  return true;
}

async function placeCall(to) {
  setStatus("Calling…");
  el.callButton.disabled = true;

  call = await device.connect({ params: { To: to } });

  call.on("accept", () => {
    setStatus("Connected");
    enableKeypad(true);
    el.muteBtn.disabled = false;

    el.callButton.textContent = "✖";
    el.callButton.classList.add("hangup");
    el.callButton.disabled = false;

    startTimer();
  });

  call.on("disconnect", () => {
    setStatus("Call ended");
    stopTimer();
    enableKeypad(false);

    el.muteBtn.disabled = true;
    el.muteBtn.textContent = "Mute";
    el.muteBtn.classList.remove("active");
    isMuted = false;

    el.callButton.textContent = "📞";
    el.callButton.classList.remove("hangup");
    el.callButton.disabled = false;

    call = null;
  });

  call.on("error", (err) => {
    showError("Call error", err?.message ? err.message : String(err));
    setStatus("Call failed");
  });
}

// keypad digit sending
document.addEventListener("click", (e) => {
  const btn = e.target.closest(".key");
  if (!btn || !call) return;
  call.sendDigits(btn.getAttribute("data-digit"));
});

// mute
el.muteBtn.addEventListener("click", () => {
  if (!call) return;
  isMuted = !isMuted;
  call.mute(isMuted);
  el.muteBtn.textContent = isMuted ? "Unmute" : "Mute";
  el.muteBtn.classList.toggle("active", isMuted);
});

// call button
el.callButton.addEventListener("click", async () => {
  const p = params();

  // hang up
  if (call) {
    call.disconnect();
    return;
  }

  // first click: mic + init
  if (!deviceInitialized) {
    const okMic = await requestMic();
    if (!okMic) return;

    const okDev = await initDevice();
    if (!okDev) return;

    setStatus("Tap to Call");
    return; // user clicks again to place call
  }

  if (!isRegistered) {
    showError("Not ready", "Device not registered. Refresh the page.");
    return;
  }

  if (!p.to) {
    showError("Missing number", "Open with ?to=+14165551234&name=Test");
    return;
  }

  await placeCall(p.to);
});

window.addEventListener("load", () => {
  const p = params();
  el.businessName.textContent = p.name;
  el.phoneNumber.textContent = p.to || "—";
  setStatus("Tap to Call");
  if (!p.to) showError("Missing number", "Open with ?to=+14165551234&name=Test");
});

window.addEventListener("beforeunload", () => {
  try {
    if (call) call.disconnect();
    if (device) device.destroy();
  } catch (_) {}
});
