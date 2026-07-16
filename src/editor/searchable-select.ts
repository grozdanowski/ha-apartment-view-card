import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

export interface SearchableSelectOption {
  value: string;
  label: string;
  description?: string;
  icon?: string;
}

let searchableSelectId = 0;

@customElement('studio-searchable-select')
export class StudioSearchableSelect extends LitElement {
  @property({ attribute: false }) public options: SearchableSelectOption[] = [];
  @property() public value = '';
  @property() public label = 'Choose an item';
  @property() public placeholder = 'Search';
  @property({ type: Boolean, reflect: true }) public disabled = false;

  @state() private _open = false;
  @state() private _query = '';
  @state() private _activeIndex = 0;
  private readonly _listboxId = `studio-searchable-select-${++searchableSelectId}`;
  private _closeTimer: ReturnType<typeof setTimeout> | null = null;

  static styles = css`
    :host {
      position: relative;
      display: block;
      min-width: 0;
    }
    .field-label {
      display: block;
      margin-bottom: 6px;
      color: var(--secondary-text-color);
      font-size: 12px;
      font-weight: 560;
    }
    .control {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 46px;
      min-height: 48px;
      border: 1px solid
        color-mix(in srgb, var(--primary-text-color) 20%, transparent);
      border-radius: 4px;
      background: color-mix(in srgb, var(--card-background-color) 92%, #000);
      transition:
        border-color 140ms ease,
        box-shadow 140ms ease;
    }
    .control:focus-within {
      border-color: var(--studio-accent, var(--primary-color));
      box-shadow: 0 0 0 1px var(--studio-accent, var(--primary-color));
    }
    input {
      width: 100%;
      min-width: 0;
      box-sizing: border-box;
      padding: 0 14px;
      border: 0;
      outline: 0;
      background: transparent;
      color: var(--primary-text-color);
      font: inherit;
      font-size: 15px;
      text-overflow: ellipsis;
    }
    input::placeholder {
      color: var(--secondary-text-color);
    }
    .toggle {
      display: grid;
      width: 46px;
      min-height: 46px;
      place-items: center;
      padding: 0;
      border: 0;
      border-left: 1px solid
        color-mix(in srgb, var(--primary-text-color) 10%, transparent);
      background: transparent;
      color: var(--secondary-text-color);
      cursor: pointer;
    }
    .toggle ha-icon {
      --mdc-icon-size: 20px;
      transition: transform 140ms ease;
    }
    .toggle[aria-expanded='true'] ha-icon {
      transform: rotate(180deg);
    }
    .listbox {
      position: absolute;
      z-index: 30;
      inset: calc(100% + 6px) 0 auto;
      max-height: min(320px, 48vh);
      padding: 5px;
      overflow-y: auto;
      border: 1px solid
        color-mix(in srgb, var(--primary-text-color) 18%, transparent);
      border-radius: 5px;
      background: var(--card-background-color, #111718);
      box-shadow: 0 18px 44px rgba(0, 0, 0, 0.38);
    }
    .option {
      display: grid;
      grid-template-columns: 26px minmax(0, 1fr) 22px;
      align-items: center;
      gap: 9px;
      width: 100%;
      min-height: 52px;
      padding: 7px 9px;
      border: 0;
      border-radius: 3px;
      background: transparent;
      color: var(--primary-text-color);
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .option:hover,
    .option.active {
      background: color-mix(
        in srgb,
        var(--studio-accent, var(--primary-color)) 12%,
        transparent
      );
    }
    .option[aria-selected='true'] {
      background: color-mix(
        in srgb,
        var(--studio-accent, var(--primary-color)) 18%,
        transparent
      );
    }
    .option > ha-icon {
      --mdc-icon-size: 20px;
      color: var(--secondary-text-color);
    }
    .copy {
      min-width: 0;
    }
    .copy strong,
    .copy span {
      display: block;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .copy strong {
      font-size: 14px;
      font-weight: 600;
    }
    .copy span {
      margin-top: 2px;
      color: var(--secondary-text-color);
      font-size: 12px;
    }
    .check {
      --mdc-icon-size: 18px;
      color: var(--studio-accent, var(--primary-color));
    }
    .empty {
      padding: 16px 12px;
      color: var(--secondary-text-color);
      font-size: 13px;
      text-align: center;
    }
    :host([disabled]) {
      opacity: 0.55;
      pointer-events: none;
    }
    @media (max-width: 620px) {
      .control {
        min-height: 52px;
      }
      .listbox {
        position: fixed;
        z-index: 1000;
        inset: auto 12px 12px;
        max-height: min(58vh, 430px);
        padding: 7px;
        border-radius: 7px;
      }
      .option {
        min-height: 56px;
      }
    }
  `;

  public disconnectedCallback(): void {
    if (this._closeTimer) clearTimeout(this._closeTimer);
    super.disconnectedCallback();
  }

  private get _selected(): SearchableSelectOption | undefined {
    return this.options.find((option) => option.value === this.value);
  }

  private get _filtered(): SearchableSelectOption[] {
    const query = this._query.trim().toLocaleLowerCase();
    if (!query) return this.options;
    return this.options.filter((option) =>
      `${option.label} ${option.description ?? ''} ${option.value}`
        .toLocaleLowerCase()
        .includes(query),
    );
  }

  private _openPicker(clearQuery = true): void {
    if (this.disabled) return;
    if (this._closeTimer) clearTimeout(this._closeTimer);
    if (clearQuery) this._query = '';
    this._open = true;
    const selectedIndex = this._filtered.findIndex(
      (option) => option.value === this.value,
    );
    this._activeIndex = Math.max(0, selectedIndex);
  }

  private _scheduleClose(): void {
    if (this._closeTimer) clearTimeout(this._closeTimer);
    this._closeTimer = setTimeout(() => {
      this._open = false;
    }, 120);
  }

  private _choose(option: SearchableSelectOption): void {
    this._open = false;
    this._query = '';
    if (option.value === this.value) return;
    this.dispatchEvent(
      new CustomEvent('value-changed', {
        detail: { value: option.value },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _onInput(event: Event): void {
    this._query = (event.target as HTMLInputElement).value;
    this._open = true;
    this._activeIndex = 0;
  }

  private _onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this._open = false;
      this._query = '';
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!this._open) this._openPicker(false);
      const length = this._filtered.length;
      if (!length) return;
      this._activeIndex =
        (this._activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + length) %
        length;
      return;
    }
    if (event.key === 'Enter' && this._open) {
      event.preventDefault();
      const option = this._filtered[this._activeIndex];
      if (option) this._choose(option);
    }
  }

  protected render() {
    const filtered = this._filtered;
    const displayValue = this._open
      ? this._query
      : (this._selected?.label ?? '');
    return html`
      <label class="field-label" for=${`${this._listboxId}-input`}
        >${this.label}</label
      >
      <div class="control">
        <input
          id=${`${this._listboxId}-input`}
          type="text"
          role="combobox"
          autocomplete="off"
          spellcheck="false"
          aria-autocomplete="list"
          aria-expanded=${this._open}
          aria-controls=${this._listboxId}
          aria-activedescendant=${this._open && filtered[this._activeIndex]
            ? `${this._listboxId}-${this._activeIndex}`
            : nothing}
          placeholder=${this._open ? this.placeholder : 'Choose…'}
          .value=${displayValue}
          ?disabled=${this.disabled}
          @focus=${() => this._openPicker()}
          @click=${() => this._openPicker(false)}
          @input=${this._onInput}
          @keydown=${this._onKeydown}
          @blur=${this._scheduleClose}
        />
        <button
          class="toggle"
          type="button"
          aria-label=${this._open ? 'Close options' : 'Open options'}
          aria-expanded=${this._open}
          @pointerdown=${(event: PointerEvent) => event.preventDefault()}
          @click=${() => {
            this._open ? (this._open = false) : this._openPicker();
          }}
        >
          <ha-icon icon="mdi:chevron-down"></ha-icon>
        </button>
      </div>
      ${this._open
        ? html`<div
            id=${this._listboxId}
            class="listbox"
            role="listbox"
            aria-label=${this.label}
          >
            ${filtered.length
              ? filtered.map(
                  (option, index) => html`
                    <button
                      id=${`${this._listboxId}-${index}`}
                      class=${`option ${index === this._activeIndex ? 'active' : ''}`}
                      type="button"
                      role="option"
                      aria-selected=${option.value === this.value}
                      @pointerdown=${(event: PointerEvent) =>
                        event.preventDefault()}
                      @mouseenter=${() => {
                        this._activeIndex = index;
                      }}
                      @click=${() => this._choose(option)}
                    >
                      <ha-icon
                        icon=${option.icon ?? 'mdi:circle-small'}
                      ></ha-icon>
                      <span class="copy"
                        ><strong>${option.label}</strong>${option.description
                          ? html`<span>${option.description}</span>`
                          : nothing}</span
                      >
                      ${option.value === this.value
                        ? html`<ha-icon
                            class="check"
                            icon="mdi:check"
                          ></ha-icon>`
                        : nothing}
                    </button>
                  `,
                )
              : html`<div class="empty">No matching items</div>`}
          </div>`
        : nothing}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'studio-searchable-select': StudioSearchableSelect;
  }
}
