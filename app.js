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
let nextNoteTime = 0.0; // The audio context time when the next beat is scheduled
let currentBeat = 0;    // The current beat within the root cycle
let timerWorker = null; // Used for look-ahead scheduling
let audioInitialized = false; // Flag for mobile initialization

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

// --- New Initialization/Unlock Function ---

/** * Initializes the AudioContext and unlocks it on mobile browsers 
 * by playing a silent sound immediately upon user interaction.
 */
function initAudioContext() {
    if (audioInitialized) return;

    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    
    // Play a silent buffer to satisfy the mobile browser's gesture requirement
    const buffer = audioContext.createBuffer(1, 1, 22050); // 1-channel, 1-sample, 22050Hz rate
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContext.destination);
    source.start(0);

    // Call resume() just in case the context was created in a suspended state
    if (audioContext.state === 'suspended') {
        audioContext.resume();
    }
    
    audioInitialized = true;
    console.log("AudioContext unlocked and initialized.");
}


// --- Core Functions ---

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

/** Creates and schedules the click sound using the Web Audio API. */
function scheduleClick(time, beatNumber) {
    const isDownbeat = (beatNumber === 1);
    
    // Check if the context is still running before scheduling
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

    // --- Visual Update Scheduling ---
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

/** Calculates the next beat and schedules all necessary sounds/updates. */
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

/** Initializes and starts the metronome. */
function startMetronome() {
    if (isRunning) return;

    // 🔑 STEP 1: Initialize and Unlock AudioContext on the very first start click
    if (!audioInitialized) {
        initAudioContext();
    } else if (audioContext.state === 'suspended') {
        // If already initialized but suspended (e.g., user stopped it), just resume.
        audioContext.resume();
    }
    
    // Safety check: if audio context still hasn't initialized, stop.
    if (!audioContext || audioContext.state === 'closed') return;


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

/** Stops the metronome. */
function stopMetronome() {
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
}

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    updateRoots(); 
    upcomingRoot = generateNewRoot(currentRoot); 
    upcomingRootEl.textContent = upcomingRoot;
    setupListeners();
});
