import { LitElement, css, html } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';

@customElement('element-editor-dialog')
export class ElementEditorDialog extends LitElement {
  @property({ type: Boolean, reflect: true }) open = false;
  @property() title = 'Edit Element';
  @query('dialog') private _dialog?: HTMLDialogElement;

  static styles = css`
    :host { display: contents; }
    dialog {
      width: min(1180px, calc(100vw - 32px));
      height: min(860px, calc(100dvh - 32px));
      max-width: none;
      max-height: none;
      padding: 0;
      overflow: hidden;
      border: 0;
      border-radius: 8px;
      background: var(--card-background-color, var(--primary-background-color));
      color: var(--primary-text-color);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.38);
    }
    dialog::backdrop { background: rgba(4, 7, 8, 0.72); }
    .shell { display: grid; grid-template-rows: auto minmax(0, 1fr) auto; height: 100%; }
    header, footer {
      display: flex;
      align-items: center;
      gap: 12px;
      min-height: 64px;
      box-sizing: border-box;
      padding: 10px 18px;
      background: var(--card-background-color, var(--primary-background-color));
    }
    header { border-bottom: 1px solid color-mix(in srgb, var(--primary-text-color) 14%, transparent); }
    footer { justify-content: flex-end; border-top: 1px solid color-mix(in srgb, var(--primary-text-color) 14%, transparent); }
    h2 {
      min-width: 0;
      flex: 1;
      margin: 0;
      overflow: hidden;
      font-size: 20px;
      font-weight: 620;
      letter-spacing: 0;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .close, footer button {
      min-width: 44px;
      min-height: 44px;
      box-sizing: border-box;
      border: 1px solid color-mix(in srgb, var(--primary-text-color) 18%, transparent);
      border-radius: 4px;
      background: transparent;
      color: var(--primary-text-color);
      cursor: pointer;
      font: inherit;
    }
    .close { display: grid; width: 44px; padding: 0; place-items: center; border-color: transparent; }
    .close ha-icon { --mdc-icon-size: 22px; }
    footer button { padding: 0 18px; }
    footer .apply { border-color: var(--primary-color, #9fd8df); background: var(--primary-color, #9fd8df); color: var(--text-primary-color, #081012); }
    button:focus-visible { outline: 2px solid var(--primary-color, #9fd8df); outline-offset: 2px; }
    .body { min-height: 0; overflow: hidden; }

    @media (max-width: 700px) {
      dialog {
        inset: 0;
        width: 100vw;
        height: 100dvh;
        margin: 0;
        border-radius: 0;
      }
      header { min-height: 58px; padding: 7px 10px 7px 16px; }
      footer {
        min-height: 68px;
        padding: 10px 12px calc(10px + env(safe-area-inset-bottom));
      }
      footer button { flex: 1; }
      h2 { font-size: 18px; }
    }

    @media (prefers-reduced-motion: reduce) {
      dialog { scroll-behavior: auto; }
    }
  `;

  protected updated(): void {
    const dialog = this._dialog;
    if (!dialog) return;
    if (this.open && !dialog.open) {
      dialog.showModal();
      queueMicrotask(() => {
        const first = this.querySelector<HTMLElement>('[autofocus], input, select, textarea, button');
        (first ?? dialog).focus();
      });
    } else if (!this.open && dialog.open) {
      dialog.close();
    }
  }

  private _cancel(): void {
    this.dispatchEvent(new CustomEvent('element-editor-cancel', { bubbles: true, composed: true }));
  }

  private _apply(): void {
    this.dispatchEvent(new CustomEvent('element-editor-apply', { bubbles: true, composed: true }));
  }

  protected render() {
    return html`
      <dialog
        aria-labelledby="element-editor-title"
        @cancel=${(event: Event) => { event.preventDefault(); this._cancel(); }}
        @click=${(event: MouseEvent) => { if (event.target === this._dialog) this._cancel(); }}
      >
        <div class="shell">
          <header>
            <h2 id="element-editor-title">${this.title}</h2>
            <button class="close" aria-label="Cancel and close Element editor" title="Close" @click=${this._cancel}>
              <ha-icon icon="mdi:close"></ha-icon>
            </button>
          </header>
          <div class="body"><slot></slot></div>
          <footer>
            <button @click=${this._cancel}>Cancel</button>
            <button class="apply" @click=${this._apply}>Apply</button>
          </footer>
        </div>
      </dialog>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'element-editor-dialog': ElementEditorDialog;
  }
}
