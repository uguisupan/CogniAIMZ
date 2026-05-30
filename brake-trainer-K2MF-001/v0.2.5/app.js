// アプリケーションの状態管理
const state = {
    // デバイス関連
    selectedGamepadIndex: null,
    selectedAxisIndex: null,
    invertAxis: false,
    
    // キャリブレーション値 (生入力値)
    calMin: 0.0,
    calMax: 1.0,
    
    // 現在の入力値
    rawBrakeValue: 0.0,
    normalizedBrakeValue: 0.0,
    inputSource: 'なし', // 'gamepad', 'keyboard', 'none'
    
    // キーボードシミュレーション
    keyboardBrakeActive: false,
    keyboardTargetValue: 0.0,
    keyboardCurrentValue: 0.0,
    
    // 保存された設定の一時復元用
    savedDeviceName: null,
    savedGamepadIndex: null,
    savedAxisIndex: null,

    // ゲームプレイ状態
    gameState: 'idle', // 'idle', 'playing', 'results'
    score: 0,
    combo: 0,
    maxCombo: 0,
    currentPattern: 'basic',
    gameStartTime: 0,
    activeNotes: [],
    
    // トリガー検知用
    lastBrakeValue: 0.0,
    
    // 判定統計
    perfectCount: 0,
    greatCount: 0,
    goodCount: 0,
    missCount: 0,
    
    // 判定テキストの表示制御用
    judgementText: 'READY',
    judgementClass: '',
    judgementTimer: 0,

    // ベンチマーク用ログ
    benchmarkLog: [],
    benchmarkIntervalTicks: 0,
    benchmarkIntervalDragSum: 0,

    // 表示モード
    displayMode: 'symmetric' // 'symmetric', 'telemetry'
};

// DOM要素の取得
const deviceSelect = document.getElementById('device-select');
const axisSelect = document.getElementById('axis-select');
const invertAxisCheckbox = document.getElementById('invert-axis');
const connectionStatus = document.getElementById('connection-status');

const calMinBtn = document.getElementById('cal-min-btn');
const calMaxBtn = document.getElementById('cal-max-btn');
const calMinValSpan = document.getElementById('cal-min-val');
const calMaxValSpan = document.getElementById('cal-max-val');

const debugRawVal = document.getElementById('debug-raw-val');
const debugNormVal = document.getElementById('debug-norm-val');
const debugSource = document.getElementById('debug-source');

const settingsCard = document.getElementById('settings-card');
const settingsToggle = document.getElementById('settings-toggle');
const startBtn = document.getElementById('start-btn');
const stopBtn = document.getElementById('stop-btn');
const patternSelect = document.getElementById('pattern-select');
const displayModeSelect = document.getElementById('display-mode-select');
const scoreVal = document.getElementById('score-val');
const comboVal = document.getElementById('combo-val');
const judgementDisplay = document.getElementById('judgement-display');

// タブおよびダッシュボード関連 DOM
const tabButtons = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');
const tabBtnAnalyze = document.getElementById('tab-btn-analyze');
const tabBtnHistory = document.getElementById('tab-btn-history');

const resScore = document.getElementById('res-score');
const resAcc3 = document.getElementById('res-acc3');
const resAcc6 = document.getElementById('res-acc6');
const resAccPoor = document.getElementById('res-acc-poor');
const dragWarningBox = document.getElementById('drag-warning-box');
const dragAvgVal = document.getElementById('drag-avg-val');
const downloadLogBtn = document.getElementById('download-log-btn');
const notesAccuracyList = document.getElementById('notes-accuracy-list');

const historyTable = document.getElementById('history-table');
const historyEmptyMsg = document.getElementById('history-empty-msg');

// Chart.js インスタンス保持用
let trajectoryChartInstance = null;
let historyChartInstance = null;

// Canvas設定
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const LANE_WIDTH = 300;
const LANE_X = (canvas.width - LANE_WIDTH) / 2; // レーンの開始X (50)
const JUDGE_LINE_Y = canvas.height - 100; // 判定ラインのY座標 (500)
const NOTE_SPEED = 0.25; // 1msあたりに落下するピクセル数

// カラー定数
const COLOR_PRIMARY = '#00d2ff'; // ネオンブルー
const COLOR_ACCENT = '#ff0055';  // ネオンレッド

// 音声シンセサイザー (Web Audio API)
let audioCtx = null;

function initAudio() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
}

// サウンドの再生（シンセサイザー）
function playSound(type) {
    if (!audioCtx) return;
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }

    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    const now = audioCtx.currentTime;

    if (type === 'perfect') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1000, now);
        osc.frequency.exponentialRampToValueAtTime(1500, now + 0.08);
        gainNode.gain.setValueAtTime(0.2, now);
        gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.08);
        osc.start(now);
        osc.stop(now + 0.08);
    } else if (type === 'great' || type === 'good') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(800, now);
        osc.frequency.exponentialRampToValueAtTime(1100, now + 0.08);
        gainNode.gain.setValueAtTime(0.15, now);
        gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.08);
        osc.start(now);
        osc.stop(now + 0.08);
    } else if (type === 'miss') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(150, now);
        osc.frequency.linearRampToValueAtTime(100, now + 0.15);
        gainNode.gain.setValueAtTime(0.25, now);
        gainNode.gain.linearRampToValueAtTime(0.01, now + 0.15);
        osc.start(now);
        osc.stop(now + 0.15);
    } else if (type === 'tick') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(600, now);
        gainNode.gain.setValueAtTime(0.04, now);
        gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.03);
        osc.start(now);
        osc.stop(now + 0.03);
    }
}

// 練習パターンのノーツ定義 (時間単位: ミリ秒)
// targetPressure: 0.0 ➔ ペダルを完全に離す (0%ノーツ/リリースゲート)
const PATTERNS = {
    basic: [
        { time: 2000, duration: 0, targetPressure: 0.5, type: 'single' },
        { time: 4000, duration: 0, targetPressure: 0.8, type: 'single' },
        { time: 5500, duration: 1200, targetPressure: 0.0, type: 'hold' }, // 0%戻し
        { time: 7500, duration: 1500, targetPressure: 0.5, type: 'hold' },
        { time: 10000, duration: 1200, targetPressure: 0.0, type: 'hold' }, // 0%戻し
        { time: 12000, duration: 0, targetPressure: 1.0, type: 'single' },
        { time: 14000, duration: 2000, targetPressure: 0.8, type: 'hold' },
        { time: 17000, duration: 1500, targetPressure: 0.0, type: 'hold' }, // 0%戻し
        { time: 19500, duration: 0, targetPressure: 0.6, type: 'single' }
    ],
    trail: [
        { time: 2000, duration: 2500, targetPressure: 1.0, type: 'trail', trailEndPressure: 0.0 }, // 100% -> 0%
        { time: 4700, duration: 1200, targetPressure: 0.0, type: 'hold' }, // 0%完全リリース維持
        { time: 6500, duration: 2000, targetPressure: 0.8, type: 'trail', trailEndPressure: 0.2 }, // 80% -> 20%
        { time: 8700, duration: 1200, targetPressure: 0.0, type: 'hold' }, // 0%完全リリース維持
        { time: 10500, duration: 1500, targetPressure: 0.6, type: 'trail', trailEndPressure: 0.0 }, // 60% -> 0%
        { time: 12200, duration: 1200, targetPressure: 0.0, type: 'hold' }, // 0%完全リリース維持
        { time: 14000, duration: 3000, targetPressure: 1.0, type: 'trail', trailEndPressure: 0.0 }, // 100% -> 0% (3秒)
        { time: 17200, duration: 1500, targetPressure: 0.0, type: 'hold' }, // 0%完全リリース維持
        { time: 19500, duration: 2000, targetPressure: 0.8, type: 'trail', trailEndPressure: 0.0 }
    ],
    combined: [
        { time: 2000, duration: 0, targetPressure: 0.5, type: 'single' },
        { time: 3500, duration: 0, targetPressure: 0.8, type: 'single' },
        { time: 4800, duration: 1000, targetPressure: 0.0, type: 'hold' }, // 0%戻し
        { time: 6500, duration: 2500, targetPressure: 0.9, type: 'trail', trailEndPressure: 0.1 },
        { time: 9200, duration: 1200, targetPressure: 0.0, type: 'hold' }, // 0%戻し
        { time: 11000, duration: 1500, targetPressure: 0.6, type: 'hold' },
        { time: 13000, duration: 1200, targetPressure: 0.0, type: 'hold' }, // 0%戻し
        { time: 15000, duration: 3000, targetPressure: 1.0, type: 'trail', trailEndPressure: 0.0 },
        { time: 18200, duration: 1200, targetPressure: 0.0, type: 'hold' }  // 0%戻し
    ],
    benchmark: [
        { time: 2000, duration: 1000, targetPressure: 0.2, type: 'hold', name: "20% ショートホールド" },
        { time: 4500, duration: 1000, targetPressure: 0.8, type: 'hold', name: "80% ショートホールド" },
        { time: 7000, duration: 2000, targetPressure: 0.1, type: 'trail', trailEndPressure: 0.9, name: "10%→90% 線形上り" },
        { time: 10500, duration: 2000, targetPressure: 0.9, type: 'trail', trailEndPressure: 0.1, name: "90%→10% 線形下り" },
        { time: 14000, duration: 4000, targetPressure: 0.2, type: 'hold', name: "20% ロングホールド" },
        { time: 19500, duration: 4000, targetPressure: 0.8, type: 'hold', name: "80% ロングホールド" },
        { time: 25000, duration: 2000, targetPressure: 0.1, type: 's-curve', trailEndPressure: 0.9, name: "10%→90% S字上り" },
        { time: 28500, duration: 2000, targetPressure: 0.9, type: 's-curve', trailEndPressure: 0.1, name: "90%→10% S字下り" },
        
        { time: 32000, duration: 1000, targetPressure: 0.2, type: 'hold', name: "20% ショートホールド (2回目)" },
        { time: 34500, duration: 1000, targetPressure: 0.8, type: 'hold', name: "80% ショートホールド (2回目)" },
        { time: 37000, duration: 2000, targetPressure: 0.1, type: 'trail', trailEndPressure: 0.9, name: "10%→90% 線形上り (2回目)" },
        { time: 40500, duration: 2000, targetPressure: 0.9, type: 'trail', trailEndPressure: 0.1, name: "90%→10% 線形下り (2回目)" },
        { time: 44000, duration: 4000, targetPressure: 0.2, type: 'hold', name: "20% ロングホールド (2回目)" },
        { time: 49500, duration: 4000, targetPressure: 0.8, type: 'hold', name: "80% ロングホールド (2回目)" },
        { time: 55000, duration: 2000, targetPressure: 0.1, type: 's-curve', trailEndPressure: 0.9, name: "10%→90% S字上り (2回目)" },
        { time: 58500, duration: 2000, targetPressure: 0.9, type: 's-curve', trailEndPressure: 0.1, name: "90%→10% S字下り (2回目)" }
    ]
};

// アコーディオンの開閉制御
settingsToggle.addEventListener('click', () => {
    settingsCard.classList.toggle('collapsed');
});

// コントロールボタン
startBtn.addEventListener('click', () => {
    initAudio();
    startGame();
});

stopBtn.addEventListener('click', () => {
    stopGame();
});

patternSelect.addEventListener('change', (e) => {
    state.currentPattern = e.target.value;
});

displayModeSelect.addEventListener('change', (e) => {
    state.displayMode = e.target.value;
    saveSettings();
});

// ゲーム開始
function startGame() {
    state.gameState = 'playing';
    state.score = 0;
    state.combo = 0;
    state.maxCombo = 0;
    state.perfectCount = 0;
    state.greatCount = 0;
    state.goodCount = 0;
    state.missCount = 0;
    state.gameStartTime = performance.now();
    state.lastBrakeValue = 0.0;
    
    // ベンチマーク関連の初期化
    state.benchmarkLog = [];
    state.benchmarkIntervalTicks = 0;
    state.benchmarkIntervalDragSum = 0;
    
    const rawPattern = PATTERNS[state.currentPattern];
    state.activeNotes = rawPattern.map(note => ({
        ...note,
        hitState: null,
        tempHitState: null,
        tempBestMatch: 0,   // ゾーン内での最大一致度(%)
        scoreProcessed: false,
        holdTicks: 0,
        holdPerfectTicks: 0,
        ticksWithin3: 0,
        ticksWithin6: 0,
        totalTicks: 0
    }));

    startBtn.disabled = true;
    stopBtn.disabled = false;
    patternSelect.disabled = true;
    updateJudgement('GO!', 'judgement-perfect');
    
    settingsCard.classList.add('collapsed');
    
    // PLAYタブへ切り替え、ANALYZEタブを一時無効化
    switchTab('play-tab');
    tabBtnAnalyze.disabled = true;
}

// ゲーム停止
function stopGame(showResults = false) {
    state.gameState = showResults ? 'results' : 'idle';
    startBtn.disabled = false;
    stopBtn.disabled = true;
    patternSelect.disabled = false;
    
    if (!showResults) {
        updateJudgement('READY', '');
        state.score = 0;
        state.combo = 0;
        scoreVal.textContent = '000,000';
        comboVal.textContent = '0';
    } else {
        const total = state.perfectCount + state.greatCount + state.goodCount + state.missCount;
        const accuracy = total > 0 ? Math.round(((state.perfectCount + state.greatCount * 0.7 + state.goodCount * 0.4) / total) * 100) : 0;
        updateJudgement(`FINISH! ACC: ${accuracy}%`, 'judgement-great');
        
        if (state.currentPattern === 'benchmark') {
            processBenchmarkResults();
        }
    }
}

// 判定表示更新
function updateJudgement(text, className) {
    state.judgementText = text;
    state.judgementClass = className;
    judgementDisplay.textContent = text;
    judgementDisplay.className = `judgement-text ${className}`;
    state.judgementTimer = 30; 
}

// 判定ロジック
function checkJudgement(currentTime, finalBrakeValue, isBrakeTriggered) {
    const playTime = currentTime - state.gameStartTime;
    
    let allFinished = true;
    state.activeNotes.forEach(note => {
        const endTime = note.time + note.duration;
        if (playTime < endTime + 300) {
            allFinished = false;
        }
    });
    
    if (allFinished && state.activeNotes.length > 0) {
        stopGame(true);
        return;
    }

    state.activeNotes.forEach(note => {
        const timeDiff = playTime - note.time;

        if (note.type === 'single') {
            if (note.hitState === null) {
                // 1. 判定窓内での評価蓄積と一致度(Match Rate)算出
                if (timeDiff >= -150 && timeDiff <= 150) {
                    const error = Math.abs(finalBrakeValue - note.targetPressure);
                    const timeError = Math.abs(timeDiff);
                    
                    // ブレーキが最低限踏まれている場合のみ評価
                    if (finalBrakeValue > 0.08) {
                        let currentEval = null;
                        
                        if (error <= 0.08 && timeError <= 60) {
                            currentEval = 'perfect';
                        } else if (error <= 0.18 && timeError <= 100) {
                            currentEval = 'great';
                        } else if (error <= 0.30 && timeError <= 150) {
                            currentEval = 'good';
                        }
                        
                        if (currentEval !== null) {
                            // 一致度(%)の計算。タイミング40%、踏力60%の比重で算出
                            const pressMatch = Math.max(0, 1 - error);
                            const timeMatch = Math.max(0, 1 - timeError / 150);
                            const matchPercent = Math.round((pressMatch * 0.6 + timeMatch * 0.4) * 100);
                            
                            // ベストな評価と一致度を更新
                            if (note.tempHitState === null || 
                                (note.tempHitState === 'good' && (currentEval === 'great' || currentEval === 'perfect')) ||
                                (note.tempHitState === 'great' && currentEval === 'perfect')) {
                                note.tempHitState = currentEval;
                                note.tempBestMatch = Math.max(note.tempBestMatch, matchPercent);
                            }
                        }
                    }
                }
                // 2. 判定確定
                else if (timeDiff > 150) {
                    if (note.tempHitState !== null) {
                        note.hitState = note.tempHitState;
                        
                        // 一致度を含めたテキスト表示
                        const matchStr = `${note.tempBestMatch}% MATCH`;
                        
                        if (note.hitState === 'perfect') {
                            state.perfectCount++;
                            state.score += 1000 + state.combo * 10;
                            state.combo++;
                            updateJudgement(`PERFECT (${matchStr})`, 'judgement-perfect');
                            playSound('perfect');
                        } else if (note.hitState === 'great') {
                            state.greatCount++;
                            state.score += 700 + state.combo * 5;
                            state.combo++;
                            updateJudgement(`GREAT (${matchStr})`, 'judgement-great');
                            playSound('great');
                        } else {
                            state.goodCount++;
                            state.score += 400;
                            state.combo++;
                            updateJudgement(`GOOD (${matchStr})`, 'judgement-good');
                            playSound('good');
                        }
                    } else {
                        note.hitState = 'miss';
                        state.missCount++;
                        state.combo = 0;
                        updateJudgement('MISS', 'judgement-miss');
                        playSound('miss');
                    }
                }
            }
        } 
        else if (note.type === 'hold' || note.type === 'trail' || note.type === 's-curve') {
            const noteDuration = note.duration;
            
            if (playTime >= note.time && playTime <= note.time + noteDuration) {
                note.holdTicks++;
                
                let currentTarget = note.targetPressure;
                if (note.type === 'trail') {
                    const ratio = (playTime - note.time) / noteDuration;
                    const startP = note.targetPressure;
                    const endP = note.trailEndPressure;
                    currentTarget = startP + (endP - startP) * ratio;
                } else if (note.type === 's-curve') {
                    const ratio = (playTime - note.time) / noteDuration;
                    const startP = note.targetPressure;
                    const endP = note.trailEndPressure;
                    const smoothedRatio = (1 - Math.cos(ratio * Math.PI)) / 2;
                    currentTarget = startP + (endP - startP) * smoothedRatio;
                }
                
                const error = Math.abs(finalBrakeValue - currentTarget);
                
                // 踏力許容誤差。0%戻しホールドの場合は、踏力8%以内を良しとする
                const tolerance = note.targetPressure === 0.0 ? 0.08 : 0.15;
                if (error <= tolerance) {
                    note.holdPerfectTicks++;
                    state.score += 5;
                } else if (error > 0.35) {
                    if (state.combo > 0 && note.holdTicks % 20 === 0) {
                        state.combo = 0;
                        updateJudgement('MISS', 'judgement-miss');
                        playSound('miss');
                    }
                }
            }
            else if (playTime > note.time + noteDuration && !note.scoreProcessed) {
                note.scoreProcessed = true;
                const ratio = note.holdTicks > 0 ? note.holdPerfectTicks / note.holdTicks : 0;
                const matchPercent = Math.round(ratio * 100);
                const matchStr = `${matchPercent}% MATCH`;
                
                if (ratio >= 0.8) {
                    note.hitState = 'perfect';
                    state.perfectCount++;
                    state.score += 1500 + state.combo * 15;
                    state.combo++;
                    updateJudgement(`PERFECT (${matchStr})`, 'judgement-perfect');
                    playSound('perfect');
                } else if (ratio >= 0.5) {
                    note.hitState = 'great';
                    state.greatCount++;
                    state.score += 1000 + state.combo * 5;
                    state.combo++;
                    updateJudgement(`GREAT (${matchStr})`, 'judgement-great');
                    playSound('great');
                } else if (ratio >= 0.2) {
                    note.hitState = 'good';
                    state.goodCount++;
                    state.score += 500;
                    state.combo++;
                    updateJudgement(`GOOD (${matchStr})`, 'judgement-good');
                    playSound('good');
                } else {
                    note.hitState = 'miss';
                    state.missCount++;
                    state.combo = 0;
                    updateJudgement('MISS', 'judgement-miss');
                    playSound('miss');
                }
            }
        }
    });

    // ベンチマークロギングとノーツ別リアルタイム精度測定
    if (state.currentPattern === 'benchmark' && state.gameState === 'playing') {
        let activeNoteIdx = -1;
        let activeNoteType = 'none';
        let targetVal = 0.0;
        
        for (let i = 0; i < state.activeNotes.length; i++) {
            const note = state.activeNotes[i];
            const endTime = note.time + note.duration;
            if (playTime >= note.time && playTime <= endTime) {
                activeNoteIdx = i;
                activeNoteType = note.type;
                
                note.totalTicks = (note.totalTicks || 0) + 1;
                
                if (note.type === 'hold') {
                    targetVal = note.targetPressure;
                } else if (note.type === 'trail') {
                    const ratio = (playTime - note.time) / note.duration;
                    targetVal = note.targetPressure + (note.trailEndPressure - note.targetPressure) * ratio;
                } else if (note.type === 's-curve') {
                    const ratio = (playTime - note.time) / note.duration;
                    const smoothedRatio = (1 - Math.cos(ratio * Math.PI)) / 2;
                    targetVal = note.targetPressure + (note.trailEndPressure - note.targetPressure) * smoothedRatio;
                }
                
                const error = Math.abs(finalBrakeValue - targetVal);
                if (error <= 0.03) {
                    note.ticksWithin3 = (note.ticksWithin3 || 0) + 1;
                }
                if (error <= 0.06) {
                    note.ticksWithin6 = (note.ticksWithin6 || 0) + 1;
                }
                break;
            }
        }
        
        // リリースインターバル（無入力期間）中の不要な引きずり圧集計
        if (activeNoteIdx === -1) {
            state.benchmarkIntervalTicks = (state.benchmarkIntervalTicks || 0) + 1;
            state.benchmarkIntervalDragSum = (state.benchmarkIntervalDragSum || 0) + finalBrakeValue;
        }
        
        state.benchmarkLog.push({
            time: Math.round(playTime),
            target: parseFloat(targetVal.toFixed(4)),
            actual: parseFloat(finalBrakeValue.toFixed(4)),
            raw: parseFloat(state.rawBrakeValue.toFixed(4)),
            noteIndex: activeNoteIdx,
            noteType: activeNoteType
        });
    }
    
    scoreVal.textContent = state.score.toLocaleString('en-US', { minimumIntegerDigits: 6, useGrouping: false });
    comboVal.textContent = state.combo.toString();
}

// 任意の時刻における目標圧力とアクティブ状態を取得するヘルパー関数
function getTargetPressureAtTime(time) {
    const transitionDuration = 300; // 立ち上がり・立ち下がり遷移時間 (ms)
    let targetPressure = 0.0;
    let isNoteActive = false;
    let noteType = 'none';

    // 時刻がどのノーツの影響範囲内にあるかを探索
    for (const note of state.activeNotes) {
        const duration = note.duration || 0;
        const startTransition = note.time - transitionDuration;
        const endTransition = note.time + duration + transitionDuration;

        if (time >= startTransition && time <= endTransition) {
            isNoteActive = true;
            noteType = note.type;

            if (note.type === 'single') {
                if (time < note.time) {
                    // 立ち上がり
                    const ratio = (time - startTransition) / transitionDuration;
                    targetPressure = note.targetPressure * ratio;
                } else {
                    // 立ち下がり
                    const ratio = (endTransition - time) / transitionDuration;
                    targetPressure = note.targetPressure * ratio;
                }
            } else { // hold, trail, s-curve
                if (time < note.time) {
                    // 立ち上がり
                    const ratio = (time - startTransition) / transitionDuration;
                    targetPressure = note.targetPressure * ratio;
                } else if (time > note.time + duration) {
                    // 立ち下がり
                    const ratio = (endTransition - time) / transitionDuration;
                    const endP = (note.type === 'trail' || note.type === 's-curve') ? note.trailEndPressure : note.targetPressure;
                    targetPressure = endP * ratio;
                } else {
                    // ノーツ本体
                    if (note.type === 'hold') {
                        targetPressure = note.targetPressure;
                    } else if (note.type === 'trail') {
                        const ratio = (time - note.time) / duration;
                        targetPressure = note.targetPressure + (note.trailEndPressure - note.targetPressure) * ratio;
                    } else if (note.type === 's-curve') {
                        const ratio = (time - note.time) / duration;
                        const smoothedRatio = (1 - Math.cos(ratio * Math.PI)) / 2;
                        targetPressure = note.targetPressure + (note.trailEndPressure - note.targetPressure) * smoothedRatio;
                    }
                }
            }
            break; // 最初に見つかったノーツの影響を採用
        }
    }

    return {
        targetPressure: targetPressure,
        isNoteActive: isNoteActive,
        noteType: noteType
    };
}

// ----------------------------------------------------
// 描画関連
// ----------------------------------------------------
function drawGame(playTime, finalBrakeValue) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // 1. レーン背景
    ctx.fillStyle = '#090d14';
    ctx.fillRect(LANE_X, 0, LANE_WIDTH, canvas.height);
    
    ctx.strokeStyle = 'rgba(0, 210, 255, 0.1)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(LANE_X, 0);
    ctx.lineTo(LANE_X, canvas.height);
    ctx.moveTo(LANE_X + LANE_WIDTH, 0);
    ctx.lineTo(LANE_X + LANE_WIDTH, canvas.height);
    ctx.stroke();
    
    // 2. 判定ライン
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(LANE_X, JUDGE_LINE_Y);
    ctx.lineTo(LANE_X + LANE_WIDTH, JUDGE_LINE_Y);
    ctx.stroke();
    
    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.fillRect(LANE_X - 6, JUDGE_LINE_Y - 4, 6, 8);
    ctx.fillRect(LANE_X + LANE_WIDTH, JUDGE_LINE_Y - 4, 6, 8);

    // 3. 次に控えているノーツ（NEXT TARGET）の探索と描画
    let nextNote = null;
    if (state.gameState === 'playing') {
        for (let i = 0; i < state.activeNotes.length; i++) {
            const note = state.activeNotes[i];
            if (note.time > playTime + 150) {
                nextNote = note;
                break;
            }
        }
    }

    if (state.gameState === 'playing' && nextNote) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.font = '600 11px "Outfit", sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText('NEXT TARGET', canvas.width - 20, 30);
        
        let nextText = `${Math.round(nextNote.targetPressure * 100)}%`;
        if (nextNote.type === 'trail') {
            nextText += ` ➔ ${Math.round(nextNote.trailEndPressure * 100)}%`;
        }
        
        ctx.fillStyle = COLOR_PRIMARY;
        ctx.font = 'bold 24px "JetBrains Mono", monospace';
        ctx.fillText(nextText, canvas.width - 20, 58);
        
        ctx.fillStyle = '#888888';
        ctx.font = '600 10px "Outfit", sans-serif';
        const displayType = nextNote.targetPressure === 0.0 ? 'RELEASE' : nextNote.type.toUpperCase();
        ctx.fillText(displayType, canvas.width - 20, 72);
    }

    // 4. 連続道路 (Path) のサンプリングと描画
    const samplePoints = [];
    const tStart = playTime - 200;
    const tEnd = playTime + 2200;
    const tStep = 40; // 40ms刻みで細かくサンプリング

    if (state.gameState === 'playing') {
        for (let t = tStart; t <= tEnd; t += tStep) {
            const y = JUDGE_LINE_Y - (t - playTime) * NOTE_SPEED;
            const sample = getTargetPressureAtTime(t);
            samplePoints.push({
                y: y,
                p: sample.targetPressure,
                isNoteActive: sample.isNoteActive,
                noteType: sample.noteType
            });
        }
    }

    if (samplePoints.length > 0) {
        if (state.displayMode === 'telemetry') {
            // ==========================================
            // テレメトリーモード (うねる1本道)
            // ==========================================
            const halfWidth = LANE_WIDTH * 0.06; // Good判定域 (6%)
            const halfExcWidth = LANE_WIDTH * 0.03; // Excellent判定域 (3%)

            // (A) Good判定幅 (ピンク/レッドのネオン道)
            ctx.fillStyle = 'rgba(255, 0, 85, 0.06)';
            ctx.beginPath();
            for (let i = 0; i < samplePoints.length; i++) {
                const pt = samplePoints[i];
                const center = LANE_X + LANE_WIDTH * pt.p;
                ctx.lineTo(center - halfWidth, pt.y);
            }
            for (let i = samplePoints.length - 1; i >= 0; i--) {
                const pt = samplePoints[i];
                const center = LANE_X + LANE_WIDTH * pt.p;
                ctx.lineTo(center + halfWidth, pt.y);
            }
            ctx.closePath();
            ctx.fill();

            // 境界線 (エッジ)
            ctx.strokeStyle = 'rgba(255, 0, 85, 0.18)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            for (let i = 0; i < samplePoints.length; i++) {
                const pt = samplePoints[i];
                const center = LANE_X + LANE_WIDTH * pt.p;
                ctx.lineTo(center - halfWidth, pt.y);
            }
            ctx.stroke();

            ctx.beginPath();
            for (let i = 0; i < samplePoints.length; i++) {
                const pt = samplePoints[i];
                const center = LANE_X + LANE_WIDTH * pt.p;
                ctx.lineTo(center + halfWidth, pt.y);
            }
            ctx.stroke();

            // (B) Excellent判定幅 (ネオンブルーの狭い道)
            ctx.fillStyle = 'rgba(0, 210, 255, 0.12)';
            ctx.beginPath();
            for (let i = 0; i < samplePoints.length; i++) {
                const pt = samplePoints[i];
                const center = LANE_X + LANE_WIDTH * pt.p;
                ctx.lineTo(center - halfExcWidth, pt.y);
            }
            for (let i = samplePoints.length - 1; i >= 0; i--) {
                const pt = samplePoints[i];
                const center = LANE_X + LANE_WIDTH * pt.p;
                ctx.lineTo(center + halfExcWidth, pt.y);
            }
            ctx.closePath();
            ctx.fill();

            // (C) センターライン (ターゲット線)
            ctx.strokeStyle = 'rgba(0, 210, 255, 0.7)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            for (let i = 0; i < samplePoints.length; i++) {
                const pt = samplePoints[i];
                const center = LANE_X + LANE_WIDTH * pt.p;
                ctx.lineTo(center, pt.y);
            }
            ctx.stroke();

        } else {
            // ==========================================
            // 左右対称モード (中央から左右にハサミ型で広がる道)
            // ==========================================
            const centerX = canvas.width / 2;
            const halfWidth = 9;       // (LANE_WIDTH * 0.06) / 2
            const halfExcWidth = 4.5;  // (LANE_WIDTH * 0.03) / 2

            // (A) 左の道路 - Good判定幅
            ctx.fillStyle = 'rgba(255, 0, 85, 0.06)';
            ctx.beginPath();
            for (let i = 0; i < samplePoints.length; i++) {
                const pt = samplePoints[i];
                const leftCenter = centerX - (LANE_WIDTH * pt.p) / 2;
                ctx.lineTo(leftCenter - halfWidth, pt.y);
            }
            for (let i = samplePoints.length - 1; i >= 0; i--) {
                const pt = samplePoints[i];
                const leftCenter = centerX - (LANE_WIDTH * pt.p) / 2;
                ctx.lineTo(leftCenter + halfWidth, pt.y);
            }
            ctx.closePath();
            ctx.fill();

            // (B) 右の道路 - Good判定幅
            ctx.beginPath();
            for (let i = 0; i < samplePoints.length; i++) {
                const pt = samplePoints[i];
                const rightCenter = centerX + (LANE_WIDTH * pt.p) / 2;
                ctx.lineTo(rightCenter - halfWidth, pt.y);
            }
            for (let i = samplePoints.length - 1; i >= 0; i--) {
                const pt = samplePoints[i];
                const rightCenter = centerX + (LANE_WIDTH * pt.p) / 2;
                ctx.lineTo(rightCenter + halfWidth, pt.y);
            }
            ctx.closePath();
            ctx.fill();

            // 左のエッジ
            ctx.strokeStyle = 'rgba(255, 0, 85, 0.18)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            for (let i = 0; i < samplePoints.length; i++) {
                const pt = samplePoints[i];
                const leftCenter = centerX - (LANE_WIDTH * pt.p) / 2;
                ctx.lineTo(leftCenter - halfWidth, pt.y);
            }
            ctx.stroke();
            ctx.beginPath();
            for (let i = 0; i < samplePoints.length; i++) {
                const pt = samplePoints[i];
                const leftCenter = centerX - (LANE_WIDTH * pt.p) / 2;
                ctx.lineTo(leftCenter + halfWidth, pt.y);
            }
            ctx.stroke();

            // 右のエッジ
            ctx.beginPath();
            for (let i = 0; i < samplePoints.length; i++) {
                const pt = samplePoints[i];
                const rightCenter = centerX + (LANE_WIDTH * pt.p) / 2;
                ctx.lineTo(rightCenter - halfWidth, pt.y);
            }
            ctx.stroke();
            ctx.beginPath();
            for (let i = 0; i < samplePoints.length; i++) {
                const pt = samplePoints[i];
                const rightCenter = centerX + (LANE_WIDTH * pt.p) / 2;
                ctx.lineTo(rightCenter + halfWidth, pt.y);
            }
            ctx.stroke();

            // (C) 左の道路 - Excellent判定幅
            ctx.fillStyle = 'rgba(0, 210, 255, 0.12)';
            ctx.beginPath();
            for (let i = 0; i < samplePoints.length; i++) {
                const pt = samplePoints[i];
                const leftCenter = centerX - (LANE_WIDTH * pt.p) / 2;
                ctx.lineTo(leftCenter - halfExcWidth, pt.y);
            }
            for (let i = samplePoints.length - 1; i >= 0; i--) {
                const pt = samplePoints[i];
                const leftCenter = centerX - (LANE_WIDTH * pt.p) / 2;
                ctx.lineTo(leftCenter + halfExcWidth, pt.y);
            }
            ctx.closePath();
            ctx.fill();

            // (D) 右の道路 - Excellent判定幅
            ctx.beginPath();
            for (let i = 0; i < samplePoints.length; i++) {
                const pt = samplePoints[i];
                const rightCenter = centerX + (LANE_WIDTH * pt.p) / 2;
                ctx.lineTo(rightCenter - halfExcWidth, pt.y);
            }
            for (let i = samplePoints.length - 1; i >= 0; i--) {
                const pt = samplePoints[i];
                const rightCenter = centerX + (LANE_WIDTH * pt.p) / 2;
                ctx.lineTo(rightCenter + halfExcWidth, pt.y);
            }
            ctx.closePath();
            ctx.fill();

            // センターライン
            ctx.strokeStyle = 'rgba(0, 210, 255, 0.7)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            for (let i = 0; i < samplePoints.length; i++) {
                const pt = samplePoints[i];
                const leftCenter = centerX - (LANE_WIDTH * pt.p) / 2;
                ctx.lineTo(leftCenter, pt.y);
            }
            ctx.stroke();

            ctx.beginPath();
            for (let i = 0; i < samplePoints.length; i++) {
                const pt = samplePoints[i];
                const rightCenter = centerX + (LANE_WIDTH * pt.p) / 2;
                ctx.lineTo(rightCenter, pt.y);
            }
            ctx.stroke();
        }

        // 5. 道路の上に重ねてBPM拍子ガイド線を描画
        const beatInterval = 500; // BPM120 = 500ms
        const startBeat = Math.ceil(tStart / beatInterval) * beatInterval;
        const endBeat = Math.floor(tEnd / beatInterval) * beatInterval;

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.lineWidth = 1;
        for (let tBeat = startBeat; tBeat <= endBeat; tBeat += beatInterval) {
            const yBeat = Math.round(JUDGE_LINE_Y - (tBeat - playTime) * NOTE_SPEED);
            if (yBeat >= 0 && yBeat <= canvas.height) {
                ctx.beginPath();
                ctx.moveTo(LANE_X, yBeat);
                ctx.lineTo(LANE_X + LANE_WIDTH, yBeat);
                ctx.stroke();

                // 道路の中心位置に小さなマーカーを描画してリズムを合わせやすくする
                const sample = getTargetPressureAtTime(tBeat);
                ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
                if (state.displayMode === 'telemetry') {
                    const cx = LANE_X + LANE_WIDTH * sample.targetPressure;
                    ctx.beginPath();
                    ctx.arc(cx, yBeat, 3, 0, Math.PI * 2);
                    ctx.fill();
                } else {
                    const centerX = canvas.width / 2;
                    const cxLeft = centerX - (LANE_WIDTH * sample.targetPressure) / 2;
                    const cxRight = centerX + (LANE_WIDTH * sample.targetPressure) / 2;
                    ctx.beginPath();
                    ctx.arc(cxLeft, yBeat, 2, 0, Math.PI * 2);
                    ctx.arc(cxRight, yBeat, 2, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
        }

        // 6. ノーツ切り替えラベルテキストの描画 (道路の端に添える)
        state.activeNotes.forEach(note => {
            const noteY = Math.round(JUDGE_LINE_Y - (note.time - playTime) * NOTE_SPEED);
            if (noteY < -20 || noteY > canvas.height + 20) return;

            let text = '';
            let color = '#ffffff';

            if (note.targetPressure === 0.0) {
                text = '0% RELEASE';
                color = '#ffaa55';
            } else if (note.type === 'single') {
                text = `${Math.round(note.targetPressure * 100)}%`;
                color = '#ffffff';
            } else if (note.type === 'hold') {
                text = `${Math.round(note.targetPressure * 100)}% KEEP`;
                color = '#ffffff';
            } else if (note.type === 'trail') {
                text = `${Math.round(note.targetPressure * 100)}% ➔ ${Math.round(note.trailEndPressure * 100)}%`;
                color = '#ffffff';
            } else if (note.type === 's-curve') {
                text = `${Math.round(note.targetPressure * 100)}% ➔ ${Math.round(note.trailEndPressure * 100)}% (S)`;
                color = '#ffffff';
            }

            ctx.fillStyle = color;
            ctx.font = 'bold 11px "JetBrains Mono", monospace';

            if (state.displayMode === 'telemetry') {
                const startX = LANE_X + LANE_WIDTH * note.targetPressure;
                ctx.textAlign = startX > (LANE_X + LANE_WIDTH / 2) ? 'right' : 'left';
                const offset = startX > (LANE_X + LANE_WIDTH / 2) ? -15 : 15;
                ctx.fillText(text, startX + offset, noteY - 6);
            } else {
                const centerX = canvas.width / 2;
                const startXRight = centerX + (LANE_WIDTH * note.targetPressure) / 2;
                ctx.textAlign = 'left';
                ctx.fillText(text, startXRight + 12, noteY - 6);
            }
        });
    }

    // 7. プレイヤー入力インジケーター (判定ライン上)
    if (state.displayMode === 'telemetry') {
        const playerWidth = LANE_WIDTH * finalBrakeValue;
        const playerX = LANE_X;
        const endX = LANE_X + playerWidth;

        ctx.shadowBlur = 15;
        ctx.shadowColor = finalBrakeValue > 0.8 ? COLOR_ACCENT : COLOR_PRIMARY;

        const playerGrad = ctx.createLinearGradient(playerX, 0, endX, 0);
        playerGrad.addColorStop(0, 'rgba(0, 210, 255, 0.2)');
        playerGrad.addColorStop(1, COLOR_PRIMARY);

        ctx.fillStyle = playerGrad;
        ctx.fillRect(playerX, JUDGE_LINE_Y - 4, playerWidth, 8);

        // 先端の光るネオンドット
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(endX, JUDGE_LINE_Y, 6, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = COLOR_PRIMARY;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(endX, JUDGE_LINE_Y, 9, 0, Math.PI * 2);
        ctx.stroke();

        ctx.shadowBlur = 0;
    } else {
        const playerWidth = LANE_WIDTH * finalBrakeValue;
        const centerX = canvas.width / 2;
        const playerX = centerX - playerWidth / 2;
        const leftX = playerX;
        const rightX = centerX + playerWidth / 2;

        ctx.shadowBlur = 15;
        ctx.shadowColor = finalBrakeValue > 0.8 ? COLOR_ACCENT : COLOR_PRIMARY;

        const playerGrad = ctx.createLinearGradient(playerX, 0, playerX + playerWidth, 0);
        playerGrad.addColorStop(0, COLOR_PRIMARY);
        playerGrad.addColorStop(0.5, '#ffffff');
        playerGrad.addColorStop(1, COLOR_PRIMARY);

        ctx.fillStyle = playerGrad;
        ctx.fillRect(playerX, JUDGE_LINE_Y - 4, playerWidth, 8);

        // 左右の先端の光るドット
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(leftX, JUDGE_LINE_Y, 4, 0, Math.PI * 2);
        ctx.arc(rightX, JUDGE_LINE_Y, 4, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = COLOR_PRIMARY;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(leftX, JUDGE_LINE_Y, 7, 0, Math.PI * 2);
        ctx.arc(rightX, JUDGE_LINE_Y, 7, 0, Math.PI * 2);
        ctx.stroke();

        ctx.shadowBlur = 0;
    }

    // 8. ％値のリアルタイムHUD表示とリリース警告 (判定ライン下)
    const currentTargetSample = getTargetPressureAtTime(playTime);
    const currentlyOnNote = currentTargetSample.isNoteActive;
    let targetPercentText = '--%';
    if (currentlyOnNote) {
        targetPercentText = `${Math.round(currentTargetSample.targetPressure * 100)}%`;
    }

    const isOverlappingNote = currentlyOnNote;
    const isBrakingWhileIdle = !isOverlappingNote && finalBrakeValue > 0.08; 

    ctx.font = 'bold 16px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    
    if (isBrakingWhileIdle) {
        ctx.fillStyle = COLOR_ACCENT; // 赤警告
        ctx.fillText(`CURRENT: ${Math.round(finalBrakeValue * 100)}%`, LANE_X + 10, JUDGE_LINE_Y + 40);
        
        // レーン中央に「RELEASE BRAKE」を点滅表示 (コックピット警告風)
        if (state.gameState === 'playing' && Math.floor(playTime / 250) % 2 === 0) {
            ctx.save();
            ctx.shadowBlur = 10;
            ctx.shadowColor = COLOR_ACCENT;
            ctx.fillStyle = COLOR_ACCENT;
            ctx.font = 'bold 18px "Outfit", sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('RELEASE BRAKE', canvas.width / 2, JUDGE_LINE_Y - 40);
            ctx.restore();
        }
    } else {
        ctx.fillStyle = '#ffffff';
        ctx.fillText(`CURRENT: ${Math.round(finalBrakeValue * 100)}%`, LANE_X + 10, JUDGE_LINE_Y + 40);
    }
    
    ctx.font = 'bold 16px "JetBrains Mono", monospace';
    ctx.textAlign = 'right';
    ctx.fillStyle = isOverlappingNote ? COLOR_ACCENT : '#888888';
    
    const targetTextToShow = isOverlappingNote ? targetPercentText : '0%';
    ctx.fillText(`TARGET: ${targetTextToShow}`, LANE_X + LANE_WIDTH - 10, JUDGE_LINE_Y + 40);

    // 9. メトロノーム/ガイドクリック同期
    if (state.gameState === 'playing') {
        const beatInterval = 500; 
        const currentBeatIndex = Math.floor(playTime / beatInterval);
        
        if (!state.lastBeatIndex) state.lastBeatIndex = 0;
        if (currentBeatIndex > state.lastBeatIndex) {
            playSound('tick');
            state.lastBeatIndex = currentBeatIndex;
        }
    }
}

// ----------------------------------------------------
// 設定ロード＆セーブ
// ----------------------------------------------------
function loadSettings() {
    const saved = localStorage.getItem('brake_trainer_settings');
    console.log("loadSettings: Raw saved settings:", saved);
    if (saved) {
        try {
            const settings = JSON.parse(saved);
            state.invertAxis = settings.invertAxis || false;
            state.calMin = settings.calMin !== undefined ? settings.calMin : 0.0;
            state.calMax = settings.calMax !== undefined ? settings.calMax : 1.0;
            state.displayMode = settings.displayMode || 'symmetric';
            
            invertAxisCheckbox.checked = state.invertAxis;
            calMinValSpan.textContent = state.calMin.toFixed(4);
            calMaxValSpan.textContent = state.calMax.toFixed(4);
            displayModeSelect.value = state.displayMode;
            
            state.savedDeviceName = settings.deviceName || null;
            state.savedGamepadIndex = settings.gamepadIndex !== undefined && settings.gamepadIndex !== null ? parseInt(settings.gamepadIndex) : null;
            state.savedAxisIndex = settings.axisIndex !== undefined && settings.axisIndex !== null ? parseInt(settings.axisIndex) : null;
            
            console.log("loadSettings: Restored temporary values:", {
                deviceName: state.savedDeviceName,
                gamepadIndex: state.savedGamepadIndex,
                axisIndex: state.savedAxisIndex,
                displayMode: state.displayMode
            });
        } catch (e) {
            console.error("設定のロードに失敗しました:", e);
        }
    }
}

function saveSettings() {
    if (state.savedDeviceName !== null || state.savedGamepadIndex !== null || state.savedAxisIndex !== null) {
        console.log("saveSettings: Ignored save while restoring settings.");
        return;
    }

    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    const activeGamepad = state.selectedGamepadIndex !== null && gamepads ? gamepads[state.selectedGamepadIndex] : null;
    const deviceName = activeGamepad ? activeGamepad.id : '';

    const settings = {
        deviceName: deviceName,
        gamepadIndex: state.selectedGamepadIndex,
        axisIndex: state.selectedAxisIndex,
        invertAxis: state.invertAxis,
        calMin: state.calMin,
        calMax: state.calMax,
        displayMode: state.displayMode
    };
    console.log("saveSettings: Saving settings to localStorage:", settings);
    localStorage.setItem('brake_trainer_settings', JSON.stringify(settings));
}

// デバイスリスト監視
function updateGamepadList() {
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    if (!gamepads) return;
    
    deviceSelect.innerHTML = '<option value="">-- デバイスを選択してください --</option>';
    let activeDevicesCount = 0;
    
    for (let i = 0; i < gamepads.length; i++) {
        const gp = gamepads[i];
        if (gp) {
            const option = document.createElement('option');
            option.value = i.toString();
            option.textContent = `[ポート ${i}] ${gp.id}`;
            deviceSelect.appendChild(option);
            activeDevicesCount++;
        }
    }
    
    if (state.selectedGamepadIndex === null && state.savedDeviceName) {
        if (state.savedGamepadIndex !== null && 
            gamepads[state.savedGamepadIndex] && 
            gamepads[state.savedGamepadIndex].id === state.savedDeviceName) {
            state.selectedGamepadIndex = state.savedGamepadIndex;
            console.log(`updateGamepadList: Found exact port & name match at port ${state.savedGamepadIndex}`);
        } else {
            for (let i = 0; i < gamepads.length; i++) {
                const gp = gamepads[i];
                if (gp && gp.id === state.savedDeviceName) {
                    state.selectedGamepadIndex = i;
                    console.log(`updateGamepadList: Port changed. Found name-only match at port ${i}`);
                    break;
                }
            }
        }
    }
    
    if (state.selectedGamepadIndex !== null && gamepads[state.selectedGamepadIndex]) {
        deviceSelect.value = state.selectedGamepadIndex.toString();
        if (axisSelect.disabled || axisSelect.value === "") {
            console.log(`updateGamepadList: Initializing axis for device at index ${state.selectedGamepadIndex}`);
            onDeviceSelected(state.selectedGamepadIndex);
        }
    } else {
        state.selectedGamepadIndex = null;
        onDeviceDisconnected();
    }
    
    if (activeDevicesCount > 0) {
        connectionStatus.textContent = `${activeDevicesCount} 台のデバイスを検出`;
        connectionStatus.classList.add('connected');
    } else {
        connectionStatus.textContent = 'デバイス未接続';
        connectionStatus.classList.remove('connected');
    }
}

function onDeviceSelected(index) {
    state.selectedGamepadIndex = index;
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = gamepads ? gamepads[index] : null;
    
    if (!gp) {
        console.warn("onDeviceSelected: Gamepad not found at index", index);
        return;
    }
    
    axisSelect.disabled = false;
    axisSelect.innerHTML = '<option value="">-- ブレーキ軸を選択 --</option>';
    
    for (let i = 0; i < gp.axes.length; i++) {
        const option = document.createElement('option');
        option.value = i.toString();
        option.textContent = `Axis ${i} (初期値: ${gp.axes[i].toFixed(2)})`;
        axisSelect.appendChild(option);
    }
    
    const targetAxisIndex = state.savedAxisIndex !== null ? state.savedAxisIndex : state.selectedAxisIndex;
    console.log("onDeviceSelected: Restoring axis. targetAxisIndex:", targetAxisIndex);
    
    if (targetAxisIndex !== null && targetAxisIndex < gp.axes.length) {
        state.selectedAxisIndex = targetAxisIndex;
        axisSelect.value = targetAxisIndex.toString();
        console.log(`onDeviceSelected: Successfully restored axis to ${targetAxisIndex}`);
    } else {
        state.selectedAxisIndex = null;
        console.log("onDeviceSelected: Reset axis to null");
    }
    
    state.savedDeviceName = null;
    state.savedGamepadIndex = null;
    state.savedAxisIndex = null;
    
    saveSettings();
}

function onDeviceDisconnected() {
    axisSelect.innerHTML = '<option value="">-- 先にデバイスを選択 --</option>';
    axisSelect.disabled = true;
    state.selectedGamepadIndex = null;
    state.selectedAxisIndex = null;
}

// イベントリスナー
window.addEventListener("gamepadconnected", (e) => {
    console.log("デバイスが接続されました:", e.gamepad.id);
    updateGamepadList();
});

window.addEventListener("gamepaddisconnected", (e) => {
    console.log("デバイスの接続が解除されました:", e.gamepad.id);
    updateGamepadList();
});

deviceSelect.addEventListener('change', (e) => {
    const val = e.target.value;
    if (val !== "") {
        onDeviceSelected(parseInt(val));
    } else {
        state.selectedGamepadIndex = null;
        onDeviceDisconnected();
        saveSettings();
    }
});

axisSelect.addEventListener('change', (e) => {
    const val = e.target.value;
    state.selectedAxisIndex = val !== "" ? parseInt(val) : null;
    saveSettings();
});

invertAxisCheckbox.addEventListener('change', (e) => {
    state.invertAxis = e.target.checked;
    saveSettings();
});

calMinBtn.addEventListener('click', () => {
    state.calMin = state.rawBrakeValue;
    calMinValSpan.textContent = state.calMin.toFixed(4);
    saveSettings();
});

calMaxBtn.addEventListener('click', () => {
    state.calMax = state.rawBrakeValue;
    calMaxValSpan.textContent = state.calMax.toFixed(4);
    saveSettings();
});

// キーボード制御
const keysPressed = {};

window.addEventListener('keydown', (e) => {
    keysPressed[e.key] = true;
    
    if (e.key === ' ') {
        e.preventDefault();
        state.keyboardBrakeActive = true;
        state.keyboardTargetValue = 1.0;
    } else if (e.key >= '1' && e.key <= '5') {
        state.keyboardBrakeActive = true;
        state.keyboardTargetValue = parseInt(e.key) * 0.2;
    }
});

window.addEventListener('keyup', (e) => {
    keysPressed[e.key] = false;
    
    if (e.key === ' ') {
        state.keyboardBrakeActive = false;
        state.keyboardTargetValue = 0.0;
    } else if (e.key >= '1' && e.key <= '5') {
        let anyNumberPressed = false;
        for (let i = 1; i <= 5; i++) {
            if (keysPressed[i.toString()]) {
                anyNumberPressed = true;
                state.keyboardTargetValue = i * 0.2;
                break;
            }
        }
        if (!anyNumberPressed) {
            state.keyboardBrakeActive = false;
            state.keyboardTargetValue = 0.0;
        }
    }
});

// メインゲームループ (ポーリングと描画更新)
function updateLoop(currentTime) {
    let gamepadActive = false;
    let gamepadRaw = 0.0;
    
    if (state.selectedGamepadIndex !== null && state.selectedAxisIndex !== null) {
        const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
        const gp = gamepads ? gamepads[state.selectedGamepadIndex] : null;
        
        if (gp && gp.axes.length > state.selectedAxisIndex) {
            gamepadRaw = gp.axes[state.selectedAxisIndex];
            state.rawBrakeValue = gamepadRaw;
            gamepadActive = true;
        }
    }
    
    if (state.keyboardBrakeActive) {
        if (keysPressed[' ']) {
            state.keyboardCurrentValue += 0.15; 
            if (state.keyboardCurrentValue > 1.0) state.keyboardCurrentValue = 1.0;
        } else {
            state.keyboardCurrentValue = state.keyboardTargetValue;
        }
    } else {
        state.keyboardCurrentValue -= 0.15; 
        if (state.keyboardCurrentValue < 0.0) state.keyboardCurrentValue = 0.0;
    }
    
    let finalBrakeValue = 0.0;
    
    if (gamepadActive && Math.abs(gamepadRaw) > 0.001) {
        let norm = 0.0;
        const range = state.calMax - state.calMin;
        
        if (Math.abs(range) > 0.0001) {
            if (state.invertAxis) {
                norm = (state.calMin - gamepadRaw) / range;
            } else {
                norm = (gamepadRaw - state.calMin) / range;
            }
        }
        
        state.normalizedBrakeValue = Math.max(0.0, Math.min(1.0, norm));
        finalBrakeValue = state.normalizedBrakeValue;
        state.inputSource = 'ゲームコントローラー';
    } else if (state.keyboardCurrentValue > 0.0) {
        finalBrakeValue = state.keyboardCurrentValue;
        state.rawBrakeValue = 0.0;
        state.normalizedBrakeValue = finalBrakeValue;
        state.inputSource = 'キーボード';
    } else {
        state.rawBrakeValue = gamepadActive ? gamepadRaw : 0.0;
        state.normalizedBrakeValue = 0.0;
        state.inputSource = 'なし';
    }
    
    const isBrakeTriggered = (finalBrakeValue >= 0.15 && state.lastBrakeValue < 0.15);
    
    debugRawVal.textContent = state.rawBrakeValue.toFixed(4);
    debugNormVal.textContent = finalBrakeValue.toFixed(4);
    debugSource.textContent = state.inputSource;
    
    const playTime = state.gameState === 'playing' ? (currentTime - state.gameStartTime) : 0;
    if (state.gameState === 'playing') {
        checkJudgement(currentTime, finalBrakeValue, isBrakeTriggered);
    }
    
    drawGame(playTime, finalBrakeValue);
    
    state.lastBrakeValue = finalBrakeValue;
    
    if (state.judgementTimer > 0) {
        state.judgementTimer--;
    }
    
    requestAnimationFrame(updateLoop);
}

// ==========================================================================
// Benchmark Mode Logic & Tab Controls
// ==========================================================================

function switchTab(tabId) {
    tabContents.forEach(content => {
        if (content.id === tabId) {
            content.classList.add('active');
        } else {
            content.classList.remove('active');
        }
    });

    tabButtons.forEach(btn => {
        if (btn.getAttribute('data-tab') === tabId) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
}

function processBenchmarkResults() {
    let totalTicks3 = 0;
    let totalTicks6 = 0;
    let totalTicksAll = 0;
    
    const notesSummary = state.activeNotes.map((note, idx) => {
        const t3 = note.ticksWithin3 || 0;
        const t6 = note.ticksWithin6 || 0;
        const total = note.totalTicks || 1;
        
        totalTicks3 += t3;
        totalTicks6 += t6;
        totalTicksAll += total;
        
        const acc3 = (t3 / total) * 100;
        const acc6 = (t6 / total) * 100;
        const accPoor = 100 - acc6;
        
        return {
            name: note.name || `Note ${idx + 1}`,
            type: note.type,
            acc3: parseFloat(acc3.toFixed(1)),
            acc6: parseFloat(acc6.toFixed(1)),
            accPoor: parseFloat(accPoor.toFixed(1))
        };
    });
    
    const avgAcc3 = totalTicksAll > 0 ? (totalTicks3 / totalTicksAll) * 100 : 0;
    const avgAcc6 = totalTicksAll > 0 ? (totalTicks6 / totalTicksAll) * 100 : 0;
    const avgAccPoor = 100 - avgAcc6;
    
    const avgDrag = state.benchmarkIntervalTicks > 0 ? (state.benchmarkIntervalDragSum / state.benchmarkIntervalTicks) * 100 : 0;
    
    resScore.textContent = state.score.toLocaleString('en-US');
    resAcc3.textContent = `${avgAcc3.toFixed(1)}%`;
    resAcc6.textContent = `${avgAcc6.toFixed(1)}%`;
    resAccPoor.textContent = `${avgAccPoor.toFixed(1)}%`;
    
    if (avgDrag >= 2.0) {
        dragAvgVal.textContent = `${avgDrag.toFixed(1)}%`;
        dragWarningBox.classList.remove('hidden');
    } else {
        dragWarningBox.classList.add('hidden');
    }
    
    notesAccuracyList.innerHTML = '';
    notesSummary.forEach(note => {
        const item = document.createElement('div');
        item.className = 'note-acc-item';
        
        const goodOnly = note.acc6 - note.acc3;
        
        item.innerHTML = `
            <div class="note-acc-info">
                <span class="note-acc-name">${note.name}</span>
                <span class="note-acc-values">
                    Ex: <span>${note.acc3.toFixed(1)}%</span> | 
                    Gd: <span>${goodOnly.toFixed(1)}%</span> | 
                    Pr: <span>${note.accPoor.toFixed(1)}%</span>
                </span>
            </div>
            <div class="note-acc-gauge">
                <div class="gauge-exc" style="width: ${note.acc3}%"></div>
                <div class="gauge-gd" style="width: ${goodOnly}%"></div>
                <div class="gauge-pr" style="width: ${note.accPoor}%"></div>
            </div>
        `;
        notesAccuracyList.appendChild(item);
    });
    
    const activeGamepad = state.selectedGamepadIndex !== null && navigator.getGamepads ? navigator.getGamepads()[state.selectedGamepadIndex] : null;
    const deviceName = state.inputSource === 'キーボード' ? 'Keyboard' : (activeGamepad ? activeGamepad.id : 'Gamepad');
    
    const newRecord = {
        id: Date.now().toString(),
        date: new Date().toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
        deviceName: deviceName,
        inputSource: state.inputSource === 'キーボード' ? 'keyboard' : 'gamepad',
        score: state.score,
        acc3: parseFloat(avgAcc3.toFixed(1)),
        acc6: parseFloat(avgAcc6.toFixed(1)),
        accPoor: parseFloat(avgAccPoor.toFixed(1)),
        avgDrag: parseFloat(avgDrag.toFixed(1)),
        notes: notesSummary
    };
    
    let history = [];
    try {
        const savedHistory = localStorage.getItem('brake_trainer_benchmark_history');
        if (savedHistory) {
            history = JSON.parse(savedHistory);
        }
    } catch(e) {
        console.error("履歴のロード失敗:", e);
    }
    
    history.unshift(newRecord);
    if (history.length > 50) history.pop();
    
    localStorage.setItem('brake_trainer_benchmark_history', JSON.stringify(history));
    
    tabBtnAnalyze.disabled = false;
    switchTab('analyze-tab');
    
    drawTrajectoryChart();
    loadHistory();
}

function drawTrajectoryChart() {
    if (trajectoryChartInstance) {
        trajectoryChartInstance.destroy();
    }
    
    const ctxChart = document.getElementById('trajectory-chart').getContext('2d');
    
    const labels = state.benchmarkLog.map(item => (item.time / 1000).toFixed(2));
    const targetData = state.benchmarkLog.map(item => item.target * 100);
    const actualData = state.benchmarkLog.map(item => item.actual * 100);
    
    const noteBoundaries = [];
    let lastIdx = -1;
    state.benchmarkLog.forEach((item, idx) => {
        if (item.noteIndex !== lastIdx) {
            noteBoundaries.push({
                time: item.time / 1000,
                type: item.noteIndex === -1 ? 'interval' : 'note',
                name: item.noteIndex === -1 ? 'RELEASE' : (state.activeNotes[item.noteIndex]?.name || 'NOTE')
            });
            lastIdx = item.noteIndex;
        }
    });

    trajectoryChartInstance = new Chart(ctxChart, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: '目標踏力 (%)',
                    data: targetData,
                    borderColor: 'rgba(255, 0, 85, 0.7)',
                    borderWidth: 2,
                    borderDash: [5, 5],
                    fill: false,
                    pointRadius: 0,
                    tension: 0.1
                },
                {
                    label: '実際の踏力 (%)',
                    data: actualData,
                    borderColor: 'rgba(0, 210, 255, 1)',
                    borderWidth: 2,
                    backgroundColor: 'rgba(0, 210, 255, 0.05)',
                    fill: true,
                    pointRadius: 0,
                    tension: 0.1
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    title: {
                        display: true,
                        text: '時間 (秒)',
                        color: '#9ca3af'
                    },
                    grid: {
                        color: 'rgba(255, 255, 255, 0.05)'
                    },
                    ticks: {
                        color: '#9ca3af',
                        maxTicksLimit: 12
                    }
                },
                y: {
                    min: 0,
                    max: 100,
                    title: {
                        display: true,
                        text: '踏力 (%)',
                        color: '#9ca3af'
                    },
                    grid: {
                        color: 'rgba(255, 255, 255, 0.05)'
                    },
                    ticks: {
                        color: '#9ca3af',
                        stepSize: 20
                    }
                }
            },
            plugins: {
                legend: {
                    labels: {
                        color: '#f3f4f6',
                        font: {
                            family: 'Outfit'
                        }
                    }
                },
                tooltip: {
                    mode: 'index',
                    intersect: false
                }
            }
        },
        plugins: [{
            id: 'noteBoundaries',
            afterDraw: (chart) => {
                const ctx = chart.ctx;
                const xAxis = chart.scales.x;
                const yAxis = chart.scales.y;
                
                noteBoundaries.forEach(bound => {
                    const x = xAxis.getPixelForValue(bound.time.toFixed(2));
                    if (x >= xAxis.left && x <= xAxis.right) {
                        ctx.save();
                        ctx.strokeStyle = bound.type === 'note' ? 'rgba(255, 255, 255, 0.15)' : 'rgba(255, 85, 0, 0.1)';
                        ctx.lineWidth = 1;
                        ctx.setLineDash(bound.type === 'note' ? [4, 4] : [2, 2]);
                        ctx.beginPath();
                        ctx.moveTo(x, yAxis.top);
                        ctx.lineTo(x, yAxis.bottom);
                        ctx.stroke();
                        
                        ctx.fillStyle = bound.type === 'note' ? '#ffffff' : '#ffaa55';
                        ctx.font = '8px "Outfit", sans-serif';
                        ctx.textAlign = 'left';
                        ctx.fillText(bound.name, x + 4, yAxis.top + 10);
                        ctx.restore();
                    }
                });
            }
        }]
    });
}

function loadHistory() {
    let history = [];
    try {
        const savedHistory = localStorage.getItem('brake_trainer_benchmark_history');
        if (savedHistory) {
            history = JSON.parse(savedHistory);
        }
    } catch(e) {
        console.error("履歴ロード失敗:", e);
    }
    
    const tbody = historyTable.querySelector('tbody');
    tbody.innerHTML = '';
    
    if (history.length === 0) {
        historyEmptyMsg.classList.remove('hidden');
        historyTable.classList.add('hidden');
        if (historyChartInstance) {
            historyChartInstance.destroy();
            historyChartInstance = null;
        }
        return;
    }
    
    historyEmptyMsg.classList.add('hidden');
    historyTable.classList.remove('hidden');
    
    history.forEach(item => {
        const tr = document.createElement('tr');
        let deviceStr = item.deviceName || 'Unknown';
        if (deviceStr.length > 20) {
            deviceStr = deviceStr.substring(0, 18) + '...';
        }
        
        tr.innerHTML = `
            <td>${item.date}</td>
            <td title="${item.deviceName || ''}">${deviceStr}</td>
            <td class="font-mono">${item.score.toLocaleString()}</td>
            <td class="text-cyan font-mono">${item.acc3.toFixed(1)}%</td>
            <td class="text-success font-mono">${item.acc6.toFixed(1)}%</td>
            <td>
                <button class="btn-danger-sm" data-id="${item.id}">削除</button>
            </td>
        `;
        
        tr.querySelector('.btn-danger-sm').addEventListener('click', (e) => {
            const idToDelete = e.target.getAttribute('data-id');
            deleteHistoryItem(idToDelete);
        });
        
        tbody.appendChild(tr);
    });
    
    drawHistoryChart(history);
}

function deleteHistoryItem(id) {
    if (!confirm("この履歴データを削除しますか？")) return;
    
    let history = [];
    try {
        const savedHistory = localStorage.getItem('brake_trainer_benchmark_history');
        if (savedHistory) {
            history = JSON.parse(savedHistory);
        }
    } catch(e) {}
    
    history = history.filter(item => item.id !== id);
    localStorage.setItem('brake_trainer_benchmark_history', JSON.stringify(history));
    
    loadHistory();
}

function drawHistoryChart(history) {
    if (historyChartInstance) {
        historyChartInstance.destroy();
    }
    
    const chartData = [...history].reverse();
    const displayData = chartData.slice(-15);
    const ctxHistory = document.getElementById('history-chart').getContext('2d');
    
    const labels = displayData.map(item => item.date);
    const acc3Data = displayData.map(item => item.acc3);
    const acc6Data = displayData.map(item => item.acc6);
    
    historyChartInstance = new Chart(ctxHistory, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: '平均3%精度 (Excellent)',
                    data: acc3Data,
                    borderColor: 'rgba(0, 210, 255, 1)',
                    backgroundColor: 'rgba(0, 210, 255, 0.1)',
                    borderWidth: 2.5,
                    fill: false,
                    pointRadius: 4,
                    pointHoverRadius: 6,
                    tension: 0.15
                },
                {
                    label: '平均6%精度 (Good)',
                    data: acc6Data,
                    borderColor: 'rgba(16, 185, 129, 1)',
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    borderWidth: 2.5,
                    fill: false,
                    pointRadius: 4,
                    pointHoverRadius: 6,
                    tension: 0.15
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    grid: {
                        color: 'rgba(255, 255, 255, 0.05)'
                    },
                    ticks: {
                        color: '#9ca3af',
                        maxRotation: 45,
                        minRotation: 45
                    }
                },
                y: {
                    min: 0,
                    max: 100,
                    title: {
                        display: true,
                        text: '精度 (%)',
                        color: '#9ca3af'
                    },
                    grid: {
                        color: 'rgba(255, 255, 255, 0.05)'
                    },
                    ticks: {
                        color: '#9ca3af',
                        stepSize: 20
                    }
                }
            },
            plugins: {
                legend: {
                    labels: {
                        color: '#f3f4f6',
                        font: {
                            family: 'Outfit'
                        }
                    }
                }
            }
        }
    });
}

function downloadRawLog() {
    if (state.benchmarkLog.length === 0) {
        alert("ダウンロード可能なログがありません。");
        return;
    }
    
    let latestSummary = {};
    try {
        const history = JSON.parse(localStorage.getItem('brake_trainer_benchmark_history') || '[]');
        if (history.length > 0) {
            latestSummary = history[0];
        }
    } catch(e) {}
    
    const exportData = {
        metadata: {
            date: new Date().toISOString(),
            deviceName: latestSummary.deviceName || state.inputSource,
            inputSource: latestSummary.inputSource || state.inputSource,
            calMin: state.calMin,
            calMax: state.calMax,
            overallScore: state.score,
            avgAccuracy3: latestSummary.acc3 || 0,
            avgAccuracy6: latestSummary.acc6 || 0,
            avgAccuracyPoor: latestSummary.accPoor || 0,
            avgDragPercent: latestSummary.avgDrag || 0
        },
        timeline: state.benchmarkLog
    };
    
    const jsonString = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonString], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    
    const now = new Date();
    const dateStr = now.getFullYear() +
        String(now.getMonth() + 1).padStart(2, '0') +
        String(now.getDate()).padStart(2, '0') + '_' +
        String(now.getHours()).padStart(2, '0') +
        String(now.getMinutes()).padStart(2, '0');
        
    a.download = `brake_trainer_benchmark_${dateStr}.json`;
    document.body.appendChild(a);
    a.click();
    
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// 初期化処理
window.addEventListener('DOMContentLoaded', () => {
    loadSettings();
    updateGamepadList();
    
    // タブ切り替えリスナーの設定
    tabButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const tabId = e.target.getAttribute('data-tab');
            switchTab(tabId);
        });
    });
    
    // 履歴の初期ロード
    loadHistory();
    
    // エクスポートボタンリスナー
    downloadLogBtn.addEventListener('click', downloadRawLog);
    
    setInterval(() => {
        if (state.selectedGamepadIndex === null) {
            updateGamepadList();
        }
    }, 1000);
    
    requestAnimationFrame(updateLoop);
});
