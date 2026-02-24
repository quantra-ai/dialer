import { Device } from "@twilio/voice-sdk";
import "./style.css";

const CONFIG = {
  tokenEndpoint:
    import.meta.env.VITE_TOKEN_ENDPOINT ||
    "https://twilio-token-6608.twil.io/twilio-token",
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
  return {
    to: p.get("to"),
    name: p.get("name") || "Unknown Contact",
    recordId: p.get("recordId") || "",
  };
}

function showError(title, details) {
  el.errorContainer.innerHTML = `
    <div class="error">
      <div class="error-title">${title}</div>
      <div class="error-details">${details || ""}</div>
    </div>
  `;
}

function clearError() {
  el.errorContainer.innerHTML = "";
}

function setStatus(text) {
  el.callStatus.textContent = text;
}

function setTimerText(t) {
  el.callTimer.textContent = t;
}

function startTimer() {
  stopTimer();
  seconds = 0;
  setTimerText("00:00");
  timer = setInterval(() => {
    seconds += 1;
    const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
    const ss = String(seconds % 60).padStart(2, "0");
    setTimerText(`${mm}:${ss}`);
  }, 1000);
}

function stopTimer() {
  if (timer) clearInterval(timer);
  timer = null;
  setTimerText("00:00");
}

function enableKeypad(enabled) {
  document.querySelectorAll(".key").forEach((btn) => {
    btn.disabled = !enabled;
  });
}

// 🎙️ Voice-call audio constraints (Zoom/Teams-like defaults)
// Optional: add ?proaudio=1 to your dialer URL to use the "original sound" style mode.
function getAudioConstraints() {
  const p = new URLSearchParams(window.location.search);
  const pro = p.get("proaudio") === "1";

  // Normal mode = best for CRYSTAL CLEAR voice calls
  if (!pro) {
    return {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    };
  }

  // Pro mode = closer to "original sound" (only recommended with a headset + good mic)
  return {
    echoCancellation: true,
    noiseSuppression: false,
    autoGainControl: false,
  };
}

const AUDIO_CONSTRAINTS = getAudioConstraints();

async function requestMic() {
  try {
    await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS });
    clearError();
    return true;
  } catch (e) {
    showError(
      "Microphone blocked",
      "Allow microphone access, then refresh and try again."
    );
    return false;
  }
}

async function initDevice() {
  try {
    setStatus("Connecting…");
    clearError();

    const url = new URL(CONFIG.tokenEndpoint);
    url.searchParams.set("key", CONFIG.authKey);

    const res = await fetch(url.toString(), { method: "GET" });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Token error: ${res.status} ${txt}`);
    }

    const data = await res.json();
    if (!data.token) throw new Error("Token endpoint returned no token");

    device = new Device(data.token, {
      logLevel: 1,

      // ✅ Apply our mic constraints
      audioConstraints: AUDIO_CONSTRAINTS,

      // ✅ Force higher-quality codec & bitrate (big clarity boost)
      codecPreferences: ["opus", "pcmu"],
      maxAverageBitrate: 40000,
    });

    // 🔇 Disable Twilio SDK built-in sounds (chimes/tones)
    try {
      device.audio?.incoming?.(false);
      device.audio?.outgoing?.(false);
      device.audio?.disconnect?.(false);
      console.log("[Audio] Twilio SDK sounds disabled");
    } catch (e) {
      console.warn("[Audio] Could not disable Twilio sounds:", e);
    }

    device.on("registered", () => {
      isRegistered = true;
      setStatus("Tap to Call");
    });

    device.on("unregistered", () => {
      isRegistered = false;
      setStatus("Not Registered");
    });

    device.on("error", (err) => {
      showError("Device error", err.message || String(err));
      setStatus("Error");
    });

    await device.register();
    deviceInitialized = true;
    return true;
  } catch (err) {
    showError("Init failed", err.message || String(err));
    setStatus("Error");
    return false;
  }
}

async function placeCall(to, recordId, businessName) {
  setStatus("Calling…");
  el.callButton.disabled = true;

  const callParams = {
    To: to,
    RecordId: recordId || "",
    BusinessName: businessName || "Unknown",
  };

  call = await device.connect({ params: callParams });

  call.on("accept", () => {
    setStatus("Connected");
    enableKeypad(true);
    el.muteBtn.disabled = false;

    el.callButton.textContent = "✖";
    el.callButton.disabled = false;

    startTimer();
  });

  call.on("disconnect", () => {
    setStatus("Tap to Call");
    enableKeypad(false);
    el.muteBtn.disabled = true;

    el.callButton.textContent = "Call";
    el.callButton.disabled = false;

    call = null;
    isMuted = false;
    el.muteBtn.textContent = "Mute";
    stopTimer();
  });

  call.on("reject", () => {
    showError("Call rejected", "The call was rejected.");
    setStatus("Rejected");
    el.callButton.textContent = "Call";
    el.callButton.disabled = false;
    call = null;
    stopTimer();
  });

  call.on("error", (err) => {
    showError("Call error", err.message || String(err));
    setStatus("Error");
    el.callButton.textContent = "Call";
    el.callButton.disabled = false;
    call = null;
    stopTimer();
  });
}

function sendDtmf(digit) {
  try {
    if (call) call.sendDigits(digit);
  } catch (_) {}
}

function toggleMute() {
  if (!call) return;
  isMuted = !isMuted;
  call.mute(isMuted);
  el.muteBtn.textContent = isMuted ? "Unmute" : "Mute";
}

document.querySelectorAll(".key").forEach((btn) => {
  btn.addEventListener("click", () => {
    const digit = btn.getAttribute("data-digit");
    sendDtmf(digit);
  });
});

el.muteBtn.addEventListener("click", toggleMute);

el.callButton.addEventListener("click", async () => {
  const p = params();

  if (call) {
    call.disconnect();
    return;
  }

  if (!deviceInitialized) {
    const okMic = await requestMic();
    if (!okMic) return;

    const okDev = await initDevice();
    if (!okDev) return;

    setStatus("Tap to Call");
    return;
  }

  if (!isRegistered) {
    showError("Not ready", "Device not registered. Refresh the page.");
    return;
  }

  if (!p.to) {
    showError("Missing number", "Open with ?to=+14165551234&name=Test");
    return;
  }

  await placeCall(p.to, p.recordId, p.name);
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
