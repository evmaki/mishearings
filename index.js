import "https://cdn.jsdelivr.net/npm/p5@1.11.3/lib/p5.min.js";
import "https://cdn.jsdelivr.net/npm/tone@15.0.4/build/Tone.min.js";
import {
    StreamTranscriber,
    MoonshineSettings,
} from "https://cdn.jsdelivr.net/npm/@usefulsensors/moonshine-js@0.1.7/dist/moonshine.min.js";

// Set the asset path to the CDN root (so the models are fetched from there)
MoonshineSettings.BASE_ASSET_PATH =
    "https://cdn.jsdelivr.net/npm/@usefulsensors/moonshine-js@0.1.7/dist/";

// configure model settings and bind controllers
MoonshineSettings.FRAME_SIZE = 200;
document.querySelector("#frameSizeValue").innerHTML =
    MoonshineSettings.FRAME_SIZE + "ms";
document.querySelector("#frameSize").value = MoonshineSettings.FRAME_SIZE;

document.querySelector("#frameSize").addEventListener("input", (e) => {
    document.querySelector("#frameSizeValue").innerHTML = e.target.value + "ms";
    MoonshineSettings.FRAME_SIZE = e.target.value;
});

MoonshineSettings.MAX_SPEECH_SECS = 0.7;
document.querySelector("#bufferSizeValue").innerHTML =
    MoonshineSettings.MAX_SPEECH_SECS + "s";
document.querySelector("#bufferSize").value = MoonshineSettings.MAX_SPEECH_SECS;

document.querySelector("#bufferSize").addEventListener("input", (e) => {
    document.querySelector("#bufferSizeValue").innerHTML = e.target.value + "s";
    MoonshineSettings.MAX_SPEECH_SECS = e.target.value;
});

MoonshineSettings.MAX_RECORD_MS = undefined; // Unlimited recording length

var currentState = undefined;
var actionBlocked = true;

// generate the font-randomized title text
(() => {
    const fontFamilies = [
        "Helvetica",
        "Courier New",
        "Times New Roman",
        "Georgia",
    ];
    const titleText = "mishearings";

    for (let char of titleText) {
        var e = document.createElement("span");
        e.style.setProperty(
            "font-family",
            fontFamilies[Math.floor(Math.random() * fontFamilies.length)]
        );
        e.innerText = char;
        document.querySelector("#mishearings").appendChild(e);
    }
})();

function showModal(selector) {
    hideModals();
    actionBlocked = true;
    currentState = "modal";
    document.querySelector(selector).style.setProperty("display", "block");
    document
        .querySelector("#modalOverlay")
        .style.setProperty("display", "block");
}

function hideModals() {
    actionBlocked = false;
    currentState = "idle";
    document.querySelectorAll(".modal").forEach((element) => {
        element.style.setProperty("display", "none");
    });
    document
        .querySelector("#modalOverlay")
        .style.setProperty("display", "none");
}

// initialize the modals
(() => {
    document
        .querySelector("#modalOverlay")
        .addEventListener("click", hideModals);

    document.querySelectorAll("[data-modal-target]").forEach((element) => {
        var target = element.getAttribute("data-modal-target");
        element.addEventListener("click", () => {
            showModal(target);
        });
    });

    document.querySelectorAll("[data-modal-dismiss]").forEach((element) => {
        element.addEventListener("click", () => {
            hideModals();
        });
    });
})();

// load button
document.querySelector("#loadButton").addEventListener("click", async () => {
    await Tone.start();
    new p5(sketch);
    document.querySelector("#splashContainer").remove();

    // enable settings menu
    document
        .querySelector('[data-modal-target="#settingsModal"]')
        .removeAttribute("disabled");
});

const sketch = (p) => {
    // audio
    let envelope, transcriber, sampler, recorder, player;
    var recording = false;
    var audioPreset;
    const audioPresets = [
        ["Brian Eno", "eno.m4a"],
        ["Numbers station", "numbers.m4a"],
        ["Ever tried, ever failed", "beckett.wav"],
    ];
    audioPresets.forEach((v, i) => {
        audioPresets[i][1] = "assets/sound/" + v[1];
    });
    setAudioPreset(audioPresets[0][1]);

    // visual
    let points = [];
    let textQueue = [];
    const fonts = ["Helvetica", "Courier New", "Times New Roman", "Georgia"];

    // interface
    const grabRadius = 10;
    let grabbedText = undefined;
    var modalOpen = false;
    // const states = ["loading", "idle", "grabbing", "playing", "modal"];

    function pushText(text) {
        textQueue.push({
            x: p.mouseX,
            y: p.mouseY,
            text: text,
            fill: p.random(0, 200),
            size: p.random(12, 16),
            font: p.random(fonts),
            style: p.random() <= 0.05 ? p.ITALIC : p.NORMAL,
        });
    }

    p.setup = () => {
        transcriber = new StreamTranscriber(
            {
                onModelLoadStarted() {
                    console.log("onModelLoadStarted()");
                    currentState = "loading";
                },
                onModelLoaded() {
                    console.log("onModelLoaded()");
                    currentState = "idle";
                    actionBlocked = true;
                },
                onTranscribeStarted() {
                    // console.log("onTranscribeStarted()");
                },
                onTranscribeStopped() {
                    // console.log("onTranscribeStopped()");
                },
                onTranscriptionUpdated(text) {
                    // don't bother drawing empty transcripts, and don't draw when mouse isn't clicked
                    if (text && currentState == "playing") {
                        pushText(text);
                    }
                    // play the audio sitting in the transcriber buffer
                    player.buffer = transcriber.getAudioBuffer();
                    player.start();
                    points = [];
                },
                onTranscriptionCommitted(text) {},
            },
            "model/tiny"
        );
        transcriber.loadModel().then(() => {
            let cnv = p.createCanvas(p.windowWidth, p.windowHeight);
            cnv.mousePressed(mousePressed);
            cnv.mouseReleased(mouseReleased);

            /**
             * Signal flow:
             *
             * [GrainPlayer] -> [Envelope] -> [StreamTranscriber]
             *                                        |
             *                                 [getAudioBuffer()] -> [Player] -> Output
             *
             * The idea is to mangle the speech going into the StreamTranscriber using the
             * GrainPlayer. Then we eavesdrop on the actual frames going into Moonshine using
             * the .getAudioBuffer() method of StreamTranscriber. This allows us to play back
             * the audio frames exactly as the model hears them.
             */
            sampler = new Tone.GrainPlayer(audioPreset);
            sampler.loop = true;

            envelope = new Tone.AmplitudeEnvelope({
                attack: 0.1,
                attackCurve: "linear",
                sustain: 0.6,
                decay: 0.7,
                release: 0.1,
                releaseCurve: "linear",
            });

            sampler.connect(envelope);
            sampler.start();

            let destination = envelope.context.createMediaStreamDestination();
            envelope.connect(destination);
            let stream = destination.stream;
            transcriber.attachStream(stream);

            var filter = new Tone.Filter({
                type: "bandpass",
                frequency: 200,
                Q: 10,
            });
            envelope.connect(filter);
            filter.toDestination();

            // ideal API:
            // envelope.connect(transcriber)
            // this would require transcriber to be a MediaStreamAudioDestinationNode

            player = new Tone.Player(transcriber.getAudioBuffer());
            player.toDestination();
        });
    };

    // *****************************************
    // rendering
    // *****************************************

    function drawBufferingLine() {
        if (points.length > 0) {
            p.noFill();
            p.beginShape();
            for (let i = 0; i < points.length; i++) {
                p.vertex(points[i].x, points[i].y);
            }
            p.endShape();
        }
    }

    function drawText() {
        p.textAlign(p.CENTER);
        textQueue.forEach((v, i) => {
            p.fill(v.fill);
            p.textFont(v.font);
            p.textSize(v.size);
            p.textStyle(v.style);
            p.text(v.text, v.x, v.y);
        });
        p.textFont("Helvetica");
    }

    function drawLatency() {
        p.textSize(8);
        p.fill(200);
        p.text(
            Math.floor(StreamTranscriber.model.getLatency()) + "ms",
            p.width - 25,
            p.height
        );
    }

    function drawLoading() {
        p.textSize(16);
        p.textAlign(p.CENTER);
        if (p.frameCount % 10 == 0) p.textFont(p.random(fonts));
        p.text("Loading...", p.width / 2, p.height / 2);
    }

    const tutorialText =
        "Left click/one touch and drag to generate phrases.\n\n" +
        "Right click/two touch and drag to assemble poems.\n\n" +
        "Press q/four touch to record your own audio or read the help.\n\n";
    var tutorialStep = 0;

    function drawTutorial() {
        p.textSize(16);
        p.textAlign(p.CENTER);
        p.textFont("Helvetica");
        p.textStyle(p.NORMAL);
        p.text(
            tutorialText.substring(0, tutorialStep),
            p.width / 2,
            p.height / 2
        );
        if (p.frameCount % 3 == 0 && tutorialStep < tutorialText.length) {
            tutorialStep++;
        }
        if (tutorialStep >= tutorialText.length) {
            actionBlocked = false;
            drawBufferingLine();
        }
    }

    p.draw = () => {
        p.background(255);
        p.fill(0);
        if (currentState == "loading") {
            drawLoading();
        } else if (textQueue.length == 0) {
            drawTutorial();
        } else if (textQueue.length > 0) {
            p.cursor(p.CROSS);
            drawText();
            if (currentState == "playing") {
                drawLatency();
                drawBufferingLine();
                if (p.mouseX > 0)
                    sampler.grainSize = rescale(
                        p.mouseX,
                        0,
                        p.width,
                        0.001,
                        0.2
                    );
                if (p.mouseY > 0)
                    sampler.playbackRate = rescale(
                        p.mouseY,
                        0,
                        p.height,
                        0.5,
                        2
                    );
            }
        }

        // draw grabbing indicator
        if (
            currentState == "grabbing" &&
            grabbedText == undefined &&
            textQueue.length > 0
        ) {
            p.fill(0);
            var lerpRadius = p.lerp(
                grabRadius - 5,
                grabRadius,
                (p.frameCount % 100) / 100
            );
            p.ellipse(p.mouseX, p.mouseY, lerpRadius, lerpRadius);
            p.textStyle(p.NORMAL);
            textQueue.forEach((v, i) => {
                p.text("O", v.x, v.y);
            });
        }
    };

    // *****************************************
    // user interactions
    // *****************************************

    function toggleSettingsModal(modalState) {
        var settingsModal = document.querySelector("#settingsModal");
        modalOpen =
            modalState ||
            window
                .getComputedStyle(settingsModal)
                .getPropertyValue("display") == "none";
        actionBlocked = modalOpen;
        if (modalOpen) {
            currentState = "modal";
            showModal("#settingsModal");
        } else {
            currentState = "idle";
            hideModals();
        }
    }

    function deleteGrabbedText() {
        if (currentState == "grabbing" && grabbedText !== undefined) {
            textQueue.splice(grabbedText, 1);
            currentState = "idle";
            grabbedText = undefined;
        }
    }

    function startTranscription() {
        currentState = "playing";
        envelope.triggerAttack("0.0", 1);
        transcriber.start();
    }

    function stopTranscription() {
        currentState = "idle";
        envelope.triggerRelease();
        transcriber.stop();
        points = [];
    }

    function dragText(i, x, y, offsetY) {
        if (i !== undefined && textQueue.length > 0) {
            textQueue[i].x = p.abs(x) % p.width;
            textQueue[i].y = p.abs(y + offsetY) % p.height;
        }
    }

    function startGrabbing(x = p.mouseX, y = p.mouseY, offsetY = 0) {
        currentState = "grabbing";
        if (!grabbedText) {
            for (var i = 0; i < textQueue.length; i++) {
                if (
                    p.abs(x - textQueue[i].x) < grabRadius &&
                    p.abs(y - textQueue[i].y) < grabRadius
                ) {
                    grabbedText = i;
                    break;
                }
            }
        }
        dragText(grabbedText, x, y, offsetY);
    }

    function stopGrabbing() {
        grabbedText = undefined;
        currentState = "idle";
    }

    function updateBufferingLine() {
        points.push({ x: p.mouseX, y: p.mouseY });
    }

    // *****************************************
    // mouse events
    // *****************************************

    function mousePressed() {
        // console.log("mousePressed " + p.touches);
        if (!actionBlocked) {
            if (p.mouseButton == p.LEFT && currentState == "idle") {
                startTranscription();
            } else if (p.mouseButton == p.RIGHT && currentState == "idle") {
                currentState = "grabbing";
            }
        }
    }

    p.mouseDragged = () => {
        // console.log("mouseDragged " + p.touches);
        if (!actionBlocked) {
            if (p.mouseButton == p.LEFT && currentState == "playing") {
                updateBufferingLine();
            } else if (p.mouseButton == p.RIGHT && currentState != "playing") {
                startGrabbing();
            }
        }
    };

    function mouseReleased() {
        // console.log("mouseReleased " + p.touches);
        if (!actionBlocked) {
            stopTranscription();
            stopGrabbing();
        }
    }

    p.keyPressed = () => {
        // console.log("keyPressed")
        if (!actionBlocked) {
            if (p.key == "q") {
                toggleSettingsModal(!modalOpen);
            } else if (p.keyCode == 32) {
                deleteGrabbedText();
            }
        }
    };

    // *****************************************
    // touch events
    // *****************************************

    p.touchStarted = () => {
        // console.log("touchStarted " + p.touches);
        if (!actionBlocked) {
            if (p.touches.length == 4) {
                stopGrabbing();
                stopTranscription();
                toggleSettingsModal(true);
            }
        }
    };

    p.touchMoved = () => {
        // console.log("touchMoved " + p.touches)
        if (!actionBlocked) {
            if (p.touches.length == 1 && currentState == "idle") {
                startTranscription();
            } else if (p.touches.length == 2) {
                if (currentState == "playing") {
                    stopTranscription();
                }
                // grab with the second touch
                startGrabbing(p.touches[1].x, p.touches[1].y, -50);
            }
        }
    };

    p.touchEnded = () => {
        // console.log("touchEnded " + p.touches);
        if (!actionBlocked) {
            if (currentState == "playing") {
                stopTranscription()
            }
            else if (currentState == "grabbing" && p.touches.length != 2) {
                stopGrabbing()
            }
            else if (currentState == "grabbing" && p.touches.length == 2) {
                deleteGrabbedText()
            }
        }
    };

    // *****************************************
    // settings
    // *****************************************

    // initialize the audio presets dropdown
    (() => {
        var dropdown = document.querySelector("#audioPreset");

        audioPresets.forEach((audioPreset) => {
            var option = document.createElement("option");
            option.setAttribute("value", audioPreset[1]);
            option.innerHTML = audioPreset[0];
            dropdown.appendChild(option);
        });

        var option = document.createElement("option");
        option.setAttribute("value", "");
        option.setAttribute("id", "audioRecordingOption");
        option.setAttribute("disabled", "");
        option.innerHTML = "";
        dropdown.appendChild(option);

        dropdown.addEventListener("input", (e) => {
            setAudioPreset(e.target.value);
        });
    })();

    function setAudioPreset(presetUrl) {
        audioPreset = presetUrl;
        // set the value in the dropdown
        if (!audioPresets.some((preset) => preset[1] == audioPreset)) {
            document.querySelector("#audioRecordingOption").value = audioPreset;
            document
                .querySelector("#audioRecordingOption")
                .setAttribute("selected", "");
            document
                .querySelector("#audioRecordingOption")
                .removeAttribute("disabled");
            document.querySelector("#audioRecordingOption").innerHTML =
                "Recorded audio";
        }
        document.querySelector("#audioPreset").value = audioPreset;
        // set the source in the preview
        document
            .querySelector("#audioPresetSource")
            .setAttribute("src", audioPreset);
        // load it in the preview
        document.querySelector("#audioPresetPreview").load();
        new Tone.ToneAudioBuffer(audioPreset, (buffer) => {
            sampler.buffer = buffer;
        });
    }

    // clear canvas button
    document
        .querySelector("#clearCanvasButton")
        .addEventListener("click", () => {
            textQueue = [];
        });

    // record button
    document
        .querySelector("#audioRecordButton")
        .addEventListener("click", (e) => {
            if (recording) {
                stopRecording();
            } else {
                startRecording();
            }
        });

    async function startRecording() {
        try {
            console.log("startRecording()");
            document.querySelector("#audioRecordButton").innerHTML = "Wait...";
            document
                .querySelector("#audioRecordButton")
                .setAttribute("disabled", "");

            // Tone.UserMedia() sometimes provides a stream of the browser audio (not the mic), so use the native method to get the device ID
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: true,
            });

            const mic = new Tone.UserMedia();
            await mic.open(stream.id);

            var mono = new Tone.Mono();
            mic.connect(mono);

            recorder = new Tone.Recorder();
            mono.connect(recorder);

            document.querySelector("#audioRecordButton").innerHTML = "Stop";
            document
                .querySelector("#audioRecordButton")
                .removeAttribute("disabled");
            recorder.start();
            recording = true;

            setTimeout(async () => {
                if (recording) stopRecording();
            }, 10000);
        } catch (error) {
            console.error("Error accessing microphone:", error);
        }
    }

    function stopRecording() {
        console.log("stopRecording()");
        document.querySelector("#audioRecordButton").innerHTML = "Record";
        recording = false;
        recorder.stop().then((audioBlob) => {
            const url = URL.createObjectURL(audioBlob);
            setAudioPreset(url);
            new Tone.ToneAudioBuffer(url, (buffer) => {
                sampler.buffer = buffer;
                sampler.start();
                document
                    .querySelector("#audioPreset")
                    .setAttribute("type", recorder.mimeType);
            });
        });
    }

    // *****************************************
    // math and utilities
    // *****************************************

    function rescale(value, x, y, a, b) {
        return a + ((value - x) * (b - a)) / (y - x);
    }
};
