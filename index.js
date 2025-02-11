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

MoonshineSettings.MAX_SPEECH_SECS = 1.5;
document.querySelector("#bufferSizeValue").innerHTML =
    MoonshineSettings.MAX_SPEECH_SECS + "s";
document.querySelector("#bufferSize").value = MoonshineSettings.MAX_SPEECH_SECS;

document.querySelector("#bufferSize").addEventListener("input", (e) => {
    document.querySelector("#bufferSizeValue").innerHTML = e.target.value + "s";
    MoonshineSettings.MAX_SPEECH_SECS = e.target.value;
});

MoonshineSettings.MAX_RECORD_MS = undefined; // Unlimited recording length

// generate the cool title text
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

// load button
document.querySelector("#loadButton").addEventListener("click", async () => {
    await Tone.start();
    new p5(sketch);
    document.querySelector("#splashContainer").remove();

    // enable settings menu
    document.querySelector('[data-modal-target="#settingsModal"]').removeAttribute("disabled");
});

const sketch = (p) => {
    // audio
    let envelope, transcriber, sampler, recorder, player;
    var loading = false;
    var playing = false;
    var recording = false;
    var audioPreset;
    setAudioPreset("assets/sound/eno.m4a");

    // visual
    let points = [];
    let textQueue = [];
    const fonts = ["Helvetica", "Courier New", "Times New Roman", "Georgia"];

    // interface
    const grabRadius = 10;
    let grabbedText = undefined;
    let grabbing = false;
    var modalOpen = false;

    function setAudioPreset(presetUrl) {
        audioPreset = presetUrl;
        // set the value in the dropdown
        if (
            audioPreset !== "assets/sound/numbers.m4a" &&
            audioPreset !== "assets/sound/beckett.wav" &&
            audioPreset !== "assets/sound/eno.m4a"
        ) {
            document.querySelector("#audioRecordingOption").value = audioPreset;
            document.querySelector("#audioRecordingOption").setAttribute("selected", "")
            document.querySelector("#audioRecordingOption").removeAttribute("disabled")
            document.querySelector("#audioRecordingOption").innerHTML = "Recorded audio";
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

    document.querySelector("#audioPreset").addEventListener("input", (e) => {
        setAudioPreset(e.target.value);
    });

    document.querySelector("#clearCanvasButton").addEventListener("click", () => {
        textQueue = []
    });

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
                    loading = true;
                },
                onModelLoaded() {
                    console.log("onModelLoaded()");
                    loading = false;
                },
                onTranscribeStarted() {
                    // console.log("onTranscribeStarted()");
                },
                onTranscribeStopped() {
                    // console.log("onTranscribeStopped()");
                },
                onTranscriptionUpdated(text) {
                    // don't bother drawing empty transcripts, and don't draw when mouse isn't clicked
                    if (text && playing) {
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
             * The idea here is to mangle the speech going into the StreamTranscriber using the
             * GrainPlayer. Then we eavesdrop on the actual frames going into Moonshine using
             * the .getAudioBuffer() method of the StreamTranscriber. This allows us to play back
             * the audio exactly as the model hears it.
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

            /**
             * ideal API:
             *
             * envelope.connect(transcriber)
             */

            player = new Tone.Player(transcriber.getAudioBuffer());
            player.toDestination();
        });
    };

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

    function dragText(i) {
        if (i !== undefined && textQueue.length > 0) {
            textQueue[i].x = p.mouseX;
            textQueue[i].y = p.mouseY;
        }
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

    let tutorial = true;
    const tutorialText =
        "Left click and drag to generate phrases.\n\n" +
        "Right click and drag to assemble poems.\n\n" +
        "Press q to record your own audio or read the help.\n\n";
    var tutorialStep = 0;

    function drawTutorial() {
        p.textSize(16);
        p.textAlign(p.CENTER);
        p.textFont("Helvetica");
        p.text(
            tutorialText.substring(0, tutorialStep),
            p.width / 2,
            p.height / 2
        );
        if (p.frameCount % 3 == 0 && tutorialStep < tutorialText.length) {
            tutorialStep++;
        }
        if (tutorialStep >= tutorialText.length) {
            tutorial = false;
            drawBufferingLine();
        }
    }

    p.draw = () => {
        p.background(255);
        p.fill(0);
        if (!loading && tutorial) {
            drawTutorial();
        } else if (!loading && textQueue.length > 0) {
            p.cursor(p.CROSS);
            drawText();
            if (playing) {
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
            } else {
                p.cursor(p.HAND);
            }
        } else if (!loading && !tutorial && textQueue.length == 0) {
            drawTutorial();
        } else {
            drawLoading();
        }

        // draw grabbing indicator
        if (grabbing && grabbedText === undefined && textQueue.length > 0) {
            p.fill(0);
            var lerpRadius = p.lerp(
                grabRadius - 5,
                grabRadius,
                (p.frameCount % 100) / 100
            );
            p.ellipse(p.mouseX, p.mouseY, lerpRadius, lerpRadius);
            textQueue.forEach((v, i) => {
                p.text("O", v.x, v.y);
            });
        }
    };

    p.keyPressed = () => {
        if (!tutorial) {
            if (p.key == "q") {
                if (!modalOpen) {
                    showModal("#settingsModal");
                    modalOpen = true;
                } else {
                    hideModals();
                    modalOpen = false;
                }
            } else if (p.keyCode == 32) {
                if (grabbing && grabbedText !== undefined) {
                    textQueue.splice(grabbedText, 1);
                    grabbing = false;
                    grabbedText = undefined;
                }
            }
        }
    };

    function mousePressed() {
        if (!tutorial && p.mouseButton == p.LEFT) {
            envelope.triggerAttack("0.0", 1);
            playing = true;
            transcriber.start();
        } else if (p.mouseButton == p.RIGHT) {
            grabbing = true;
        }
    }

    p.mouseDragged = () => {
        if (!tutorial) {
            if (p.mouseButton == p.LEFT && playing) {
                points.push({ x: p.mouseX, y: p.mouseY });
            } else if (p.mouseButton == p.RIGHT) {
                grabbing = true;
                if (!grabbedText) {
                    for (var i = 0; i < textQueue.length; i++) {
                        if (
                            p.abs(p.mouseX - textQueue[i].x) < grabRadius &&
                            p.abs(p.mouseY - textQueue[i].y) < grabRadius
                        ) {
                            grabbedText = i;
                            break;
                        }
                    }
                }
                dragText(grabbedText);
            }
        }
    };

    function mouseReleased() {
        if (!tutorial) {
            if (p.mouseButton == p.LEFT) {
                envelope.triggerRelease();
                transcriber.stop();
                playing = false;
                points = [];
            }
            grabbedText = undefined;
            grabbing = false;
        }
    }

    // bind recording button
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

            // Tone.UserMedia() sometimes provides a stream of the browser audio (not the chosen mic), so use the native method to get the device ID
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

    function rescale(value, x, y, a, b) {
        return a + ((value - x) * (b - a)) / (y - x);
    }
};
