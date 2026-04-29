import React from 'react';

interface Props {
  onClose: () => void;
}

export function HelpPanel({ onClose }: Props) {
  return (
    <div className="help-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="Help">
      <div className="help-panel" onClick={e => e.stopPropagation()}>
        <div className="help-header">
          <span className="help-title">How to use Gemma4kids</span>
          <button className="help-close" onClick={onClose} aria-label="Close help">✕</button>
        </div>

        <div className="help-body">
          <section className="help-section">
            <h3>Talking to Gemma</h3>
            <p>Type what you want to make in the chat box at the bottom right, then press <strong>Send</strong>. Gemma will write an animation just for you!</p>
            <p>Examples: <em>"Make a bouncing ball"</em> · <em>"Make fireworks explode"</em> · <em>"Make fish swimming"</em></p>
          </section>

          <section className="help-section">
            <h3>🎤 Mic button</h3>
            <p>Press the microphone button and <strong>speak your idea</strong> instead of typing. Gemma will listen and then create your animation. The mic button is grey if the voice model isn't installed yet.</p>
          </section>

          <section className="help-section">
            <h3>Your Code editor</h3>
            <p>When Gemma finishes, the animation code appears in the middle panel. You can <strong>edit it yourself</strong> — change colours, sizes, speeds, anything you like!</p>
            <p>Made a mistake? Press <strong>↩ Gemma's version</strong> (top-right of the editor) to undo all your edits and go back to exactly what Gemma wrote.</p>
            <p>You can also type or paste your own code, save it, then ask Gemma to explain it! Or click any saved project in the left sidebar to load it into the editor — then ask Gemma to review it.</p>
            <p>When you change the code yourself, a <strong style={{color:'#ef4444'}}>red ●</strong> dot appears next to "Your Code". That means you have unsaved changes — press <strong>Save</strong> first so Gemma can see your latest version. When the save succeeds the dot turns <strong style={{color:'#22c55e'}}>green ●</strong> for a moment, then disappears.</p>
          </section>

          <section className="help-section">
            <h3>Save &amp; Open in Browser</h3>
            <p><strong>Save</strong> keeps your animation on your computer (in <em>Documents / KidAnimations</em>). Give it a name in the box next to the button first.</p>
            <p><strong>Open in Browser</strong> opens the animation full-screen in your web browser so you can see it properly. Press it after saving.</p>
          </section>

          <section className="help-section">
            <h3>Saved projects (left sidebar)</h3>
            <p>All your saved animations are listed here. Click one to load it back into the editor. The trash icon deletes it from your computer.</p>
          </section>

          <section className="help-section">
            <h3>Model selector</h3>
            <p>Choose which Gemma model answers you. <strong>gemma4:31b</strong> and <strong>gemma4:26b</strong> make the richest animations (need a powerful computer). <strong>gemma4:e4b</strong> is faster and smaller. <strong>gemma4:e2b</strong> works on older computers with less memory.</p>
          </section>

          <section className="help-section">
            <h3>Think / Show Thoughts</h3>
            <p><strong>Think On</strong> lets Gemma reason before answering — usually gives better animations. <strong>Show Thoughts</strong> reveals Gemma's reasoning bubble in the chat (fun to read!).</p>
          </section>

          <section className="help-section">
            <h3>Read aloud button</h3>
            <p>Each Gemma message has a small <strong>Read</strong> button. Press it to hear Gemma's reply spoken aloud. Only works if Piper voices are installed (see SETUP.md).</p>
          </section>

          <section className="help-section">
            <h3>Fresh start button</h3>
            <p>Next to the Send button you'll see a <strong>number%</strong> badge — that's how much chat space is left. When it turns orange or red, click it to start a <strong>fresh chat</strong> so Gemma doesn't forget earlier ideas.</p>
          </section>

          <section className="help-section">
            <h3>Code Runner game</h3>
            <p>While Gemma is thinking, a little side-scroller game appears at the bottom. Press <strong>Space</strong> to jump and dodge the bugs! Your high score is saved.</p>
          </section>

          <div className="help-tip">
            Works completely <strong>offline</strong> — no internet needed once models are installed.
          </div>
        </div>
      </div>
    </div>
  );
}
