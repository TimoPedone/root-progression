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
let tempo = 60; // BPM
let beatsPerRoot = 4;
let nextNoteTime = 0.0; // The audio context time when the next beat is scheduled
let currentBeat = 0;    // The current beat within the root cycle (1, 2, 3, or 4)
let timerWorker = null; // Used for look-ahead scheduling

const LOOK_AHEAD_TIME = 0.1; // How far ahead (in seconds) to schedule the audio (100ms)
const SCHEDULE_INTERVAL = 25; // How often (in ms) the worker checks the clock

// --- Root State ---
let currentRoot = 'C';
let upcomingRoot = 'G';

// --- Web Worker Code Embedded (The Fix!) ---
// This code is what used to be in metronome_worker.js
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
// Create a Blob and a URL for the worker code
const workerBlob = new Blob([workerCode], { type: 'application/javascript' });
const workerURL = URL.createObjectURL(workerBlob);
// --- End Web Worker Fix ---


// --- Core Functions ---

/** Generates a new random root, ensuring it's not the same as the current root. */
function generateNewRoot(excludeRoot) {
    let newRoot;
    do {
        const randomIndex = Math.floor(Math.random() * ROOTS.length);
        newRoot = ROOTS[randomIndex];
    } while (newRoot === excludeRoot);
    return newRoot;
}

/** Updates the displayed roots, moving upcoming to current and setting a new upcoming. */
function updateRoots() {
    currentRoot = upcomingRoot;
    upcomingRoot = generateNewRoot(currentRoot);

    currentRootEl.textContent = currentRoot;
    upcomingRootEl.textContent = upcomingRoot;
}

/** Creates and schedules the click sound using the Web Audio API. */
function scheduleClick(time, beatNumber) {
    const isDownbeat = (beatNumber === 1);
    
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    // Frequencies: 880Hz for downbeat (higher pitch), 440Hz for others
    const frequency = isDownbeat ? 880 : 440;
    // Lower volumes for a more soothing sine wave sound
    const volume = isDownbeat ? 0.6 : 0.6;
    const duration = 0.05; // 50ms click

    // 🔑 CHANGE MADE HERE: Set oscillator type to sine
    oscillator.type = 'sine'; 
    oscillator.frequency.setValueAtTime(frequency, 0);
    gainNode.gain.setValueAtTime(volume, time);

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    oscillator.start(time);
    oscillator.stop(time + duration);

    // --- Visual Update Scheduling (Aligns UI with precise audio time) ---
    const delayMilliseconds = (time - audioContext.currentTime) * 1000;

    setTimeout(() => {
        // Update Beat Indicator
        beatIndicator.textContent = `Beat ${beatNumber} of ${beatsPerRoot}`;
        
        if (isDownbeat) {
            // Flash current root color
            currentRootEl.style.color = '#1abc9c'; 
            setTimeout(() => {
                currentRootEl.style.color = '#e74c3c'; 
            }, 50);
            // Update the root display
            updateRoots();
        }
    }, delayMilliseconds);
}

/** Calculates the next beat and schedules all necessary sounds/updates. */
function scheduler() {
    const secondsPerBeat = 60.0 / tempo;

    // Schedule all beats that fall between the current time and the look-ahead time
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

/** Initializes and starts the metronome. */
function startMetronome() {
    if (isRunning) return;

    // Initialize AudioContext on user interaction
    if (audioContext === null) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioContext.state === 'suspended') {
        audioContext.resume();
    }

    isRunning = true;
    startStopBtn.textContent = 'Stop Metronome';
    startStopBtn.classList.add('running');
    
    nextNoteTime = audioContext.currentTime + 0.1; // Start in 100ms
    currentBeat = beatsPerRoot; // Set to last beat so the first scheduler call advances it to 1

    // 2. Start the Timer Worker using the Blob URL
    timerWorker = new Worker(workerURL);
    
    // Handle messages from the worker
    timerWorker.onmessage = function(e) {
        if (e.data === 'tick') {
            scheduler();
        }
    };
    
    // Initialize worker and start the loop
    timerWorker.postMessage({
        'interval': SCHEDULE_INTERVAL,
        'lookAhead': LOOK_AHEAD_TIME
    });
    timerWorker.postMessage('start');
}

/** Stops the metronome. */
function stopMetronome() {
    if (timerWorker) {
        timerWorker.terminate(); // Stop the worker loop
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
}

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    updateRoots(); // Initialize the first root pair
    upcomingRoot = generateNewRoot(currentRoot); 
    upcomingRootEl.textContent = upcomingRoot;
    setupListeners();
});