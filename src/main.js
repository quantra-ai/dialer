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

async function requestMic() {
  try {
    await navigator.mediaDevices.getUserMedia({ audio: true });
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
    });

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
    To: to, // IMPORTANT: your Twilio Function uses event.To
    RecordId: recordId || "", // NEW: used by /dial-out -> recording callback
    BusinessName: businessName || "Unknown", // NEW: filename/metadata
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

  call.on("cancel", () => {
    setStatus("Cancelled");
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
  } catch (e) {
    // ignore
  }
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
