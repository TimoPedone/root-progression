// --- JAVASCRIPT LOGIC ---

// Root Options
const ROOTS = ["C", "C#", "Db", "D", "Eb", "E", "F", "F#", "Gb", "G", "Ab", "A", "Bb", "B"];

// DOM Elements
const currentRootEl = document.getElementById('current-root');
const upcomingRootEl = document.getElementById('upcoming-root');
const tempoSlider = document.getElementById('tempo-slider');
const bpmDisplay = document.getElementById('bpm-display');
const startStopBtn = document.getElementById('start-stop-btn');
const beatIndicator = document.getElementById('beat-indicator');
const beatOptions = document.querySelectorAll('input[name="beats-per-root"]');

// --- Metronome State and Constants ---
let audioContext = null;
let isRunning = false;
let tempo = 120; // BPM
let beatsPerRoot = 2;
let nextNoteTime = 0.0; 
let currentBeat = 0;    
let timerWorker = null; 
let audioInitialized = false; 

// 🔑 NEW: Nodes for the persistent, silent audio stream
let silentToneOscillator = null;
let silentToneGain = null;

const LOOK_AHEAD_TIME = 0.1; // 100ms
const SCHEDULE_INTERVAL = 25; // 25ms

// --- Root State ---
let currentRoot = 'C';
let upcomingRoot = 'G';

// --- Web Worker Code Embedded ---
const workerCode = `
    let timerID = null;
    let interval = 25; 

    self.onmessage = function(e) {
        if (e.data.interval) {
            interval = e.data.interval;
        } 
        if (e.data === 'start') {
            if (timerID) {
                clearInterval(timerID);
            }
            timerID = setInterval(tick, interval);
        }
    };

    function tick() {
        self.postMessage('tick');
    }
`;
const workerBlob = new Blob([workerCode], { type: 'application/javascript' });
const workerURL = URL.createObjectURL(workerBlob);


// --- Persistent Audio Functions (CRITICAL FIX) ---

/** Starts the silent, persistent audio stream to prevent screen sleep. */
function startSilentAudioStream() {
    if (!audioContext) return;
    
    // Create the nodes if they don't exist
    if (!silentToneOscillator) {
        silentToneOscillator = audioContext.createOscillator();
        silentToneGain = audioContext.createGain();
        
        // Set volume to near-zero (0.0001 is often used instead of absolute 0)
        silentToneGain.gain.setValueAtTime(0.0001, audioContext.currentTime);
        
        // Use a very low frequency to minimize resource usage/audibility (e.g., 1Hz)
        silentToneOscillator.frequency.setValueAtTime(1, audioContext.currentTime);
        
        // Connect the nodes to the destination
        silentToneOscillator.connect(silentToneGain);
        silentToneGain.connect(audioContext.destination);
        
        // Start the oscillator immediately
        silentToneOscillator.start();
        console.log("Persistent silent audio stream started.");
    }
}

/** Stops and disconnects the silent audio stream. */
function stopSilentAudioStream() {
    if (silentToneOscillator) {
        // Schedule stop for immediate effect
        silentToneOscillator.stop(audioContext.currentTime);
        silentToneOscillator.disconnect();
        
        silentToneOscillator = null;
        silentToneGain = null;
        console.log("Persistent silent audio stream stopped.");
    }
}


// --- Initialization/Unlock Function ---

/** Initializes the AudioContext and unlocks it on mobile browsers. */
function initAudioContext() {
    if (audioInitialized) return;

    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    
    // Play a silent buffer to satisfy the mobile browser's gesture requirement
    const buffer = audioContext.createBuffer(1, 1, 22050); 
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContext.destination);
    source.start(0);

    if (audioContext.state === 'suspended') {
        audioContext.resume();
    }
    
    audioInitialized = true;
    console.log("AudioContext unlocked and initialized.");
}


// --- Core Functions (Unchanged) ---

function generateNewRoot(excludeRoot) {
    let newRoot;
    do {
        const randomIndex = Math.floor(Math.random() * ROOTS.length);
        newRoot = ROOTS[randomIndex];
    } while (newRoot === excludeRoot);
    return newRoot;
}

function updateRoots() {
    currentRoot = upcomingRoot;
    upcomingRoot = generateNewRoot(currentRoot);

    currentRootEl.textContent = currentRoot;
    upcomingRootEl.textContent = upcomingRoot;
}

function scheduleClick(time, beatNumber) {
    const isDownbeat = (beatNumber === 1);
    
    if (audioContext.state === 'suspended') return;
    
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    const frequency = isDownbeat ? 880 : 440;
    const volume = isDownbeat ? 0.6 : 0.4;
    const duration = 0.05; 

    oscillator.type = 'sine'; 
    oscillator.frequency.setValueAtTime(frequency, 0);
    gainNode.gain.setValueAtTime(volume, time);

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    oscillator.start(time);
    oscillator.stop(time + duration);

    const delayMilliseconds = (time - audioContext.currentTime) * 1000;

    setTimeout(() => {
        beatIndicator.textContent = `Beat ${beatNumber} of ${beatsPerRoot}`;
        
        if (isDownbeat) {
            currentRootEl.style.color = '#1abc9c'; 
            setTimeout(() => {
                currentRootEl.style.color = '#e74c3c'; 
            }, 50);
            updateRoots();
        }
    }, delayMilliseconds);
}

function scheduler() {
    const secondsPerBeat = 60.0 / tempo;

    while (nextNoteTime < audioContext.currentTime + LOOK_AHEAD_TIME) {
        
        currentBeat++;

        if (currentBeat > beatsPerRoot) {
            currentBeat = 1; 
        }

        scheduleClick(nextNoteTime, currentBeat);

        nextNoteTime += secondsPerBeat;
    }
}


// --- Control Functions ---

function startMetronome() {
    if (isRunning) return;

    // STEP 1: Initialize AudioContext
    if (!audioInitialized) {
        initAudioContext();
    } else if (audioContext.state === 'suspended') {
        audioContext.resume();
    }
    
    if (!audioContext || audioContext.state === 'closed') return;

    // 🔑 STEP 2: Start the persistent, silent audio stream
    startSilentAudioStream();

    isRunning = true;
    startStopBtn.textContent = 'Stop Metronome';
    startStopBtn.classList.add('running');
    
    nextNoteTime = audioContext.currentTime + 0.1; 
    currentBeat = beatsPerRoot; 

    // Start the Timer Worker 
    timerWorker = new Worker(workerURL);
    
    timerWorker.onmessage = function(e) {
        if (e.data === 'tick') {
            scheduler();
        }
    };
    
    timerWorker.postMessage({
        'interval': SCHEDULE_INTERVAL,
        'lookAhead': LOOK_AHEAD_TIME
    });
    timerWorker.postMessage('start');
}

function stopMetronome() {
    // 🔑 STEP 1: Stop the persistent audio stream
    stopSilentAudioStream();

    // STEP 2: Stop metronome logic
    if (timerWorker) {
        timerWorker.terminate(); 
        timerWorker = null;
    }
    isRunning = false;
    startStopBtn.textContent = 'Start Metronome';
    startStopBtn.classList.remove('running');
    beatIndicator.textContent = '';
    currentBeat = 0;
    
    if (audioContext && audioContext.state !== 'closed') {
        audioContext.suspend();
    }
}

/** Handles UI event listeners. */
function setupListeners() {
    tempoSlider.addEventListener('input', (e) => {
        tempo = parseInt(e.target.value);
        bpmDisplay.textContent = `${tempo} BPM`;
    });

    startStopBtn.addEventListener('click', () => {
        if (isRunning) {
            stopMetronome();
        } else {
            startMetronome();
        }
    });

    beatOptions.forEach(radio => {
        radio.addEventListener('change', (e) => {
            beatsPerRoot = parseInt(e.target.value);
            if (isRunning) {
                 currentBeat = beatsPerRoot;
            }
        });
    });
    
    bpmDisplay.textContent = `${tempo} BPM`;
}

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    updateRoots(); 
    upcomingRoot = generateNewRoot(currentRoot); 
    upcomingRootEl.textContent = upcomingRoot;
    setupListeners();
});
