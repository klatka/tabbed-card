import { LitElement, html, PropertyValueMap, nothing } from "lit";
import { customElement, state, property } from "lit/decorators.js";
import { styleMap } from "lit/directives/style-map.js";
import { ifDefined } from "lit/directives/if-defined.js";
import {
  getLovelace,
  hasConfigOrEntityChanged,
  HomeAssistant,
  LovelaceCard,
  LovelaceCardConfig,
  LovelaceCardEditor,
  LovelaceConfig,
} from "custom-card-helpers";
import "./registry-patch.ts";
import "./tabbed-card-editor";
import "@material/mwc-tab-bar";
import "@material/mwc-tab";

interface mwcTabBarEvent extends Event {
  detail: {
    index: number;
  };
}

interface TabbedCardConfig extends LovelaceCardConfig {
  options?: options;
  styles?: {};
  attributes?: {};
  tabs: Tab[];
}

interface options {
  defaultTabIndex?: number;
  hideEmptyTabs?: boolean;
}

interface Tab {
  styles?: {};
  attributes?: {
    label?: string;
    icon?: string;
    isFadingIndicator?: boolean;
    minWidth?: boolean;
    isMinWidthIndicator?: boolean;
    stacked?: boolean;
  };
  card: LovelaceCardConfig;
}

interface TabWithVisibility extends Tab {
  card: LovelaceCard;
  isVisible: boolean;
  originalIndex: number;
}

@customElement("tabbed-card")
export class TabbedCard extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;
  @property() protected selectedTabIndex = 0;
  @property() private _helpers: any;

  @state() private _config!: TabbedCardConfig;
  @state() private _tabs!: TabWithVisibility[];
  @state() private _visibleTabs!: TabWithVisibility[];
  @property() protected _styles = {
    "--mdc-theme-primary": "var(--primary-text-color)", // Color of the activated tab's text, indicator, and ripple.
    "--mdc-tab-text-label-color-default":
      "rgba(var(--rgb-primary-text-color), 0.8)", // Color of an unactivated tab label.
    "--mdc-tab-color-default": "rgba(var(--rgb-primary-text-color), 0.7)", // Color of an unactivated icon.
    "--mdc-typography-button-font-size": "14px",
  };

  private async loadCardHelpers() {
    this._helpers = await (window as any).loadCardHelpers();
  }

  static async getConfigElement(): Promise<LovelaceCardEditor> {
    return document.createElement("tabbed-card-editor");
  }

  static getStubConfig() {
    return {
      options: {
        hideEmptyTabs: false
      },
      tabs: [{ card: { type: "entity", entity: "sun.sun" }, attributes: { label: "Sun" } }],
    };
  }

  public setConfig(config: TabbedCardConfig) {
    if (!config) {
      throw new Error("No configuration.");
    }

    this._config = config;

    this._styles = {
      ...this._styles,
      ...this._config.styles,
    };

    this.loadCardHelpers();
  }

  protected willUpdate(
    _changedProperties: PropertyValueMap<any> | Map<PropertyKey, unknown>,
  ): void {
    if (_changedProperties.has("_helpers")) {
      this._createTabs(this._config);
    }
    if (_changedProperties.has("hass") && this._tabs?.length) {
      this._tabs.forEach((tab) => (tab.card.hass = this.hass));
      
      // Re-evaluate tab visibility when hass updates
      if (this._config?.options?.hideEmptyTabs) {
        this._updateTabVisibility();
      }
    }
  }

  private _updateTabVisibility() {
    if (!this._tabs?.length) return;

    this._tabs.forEach((tab) => {
      tab.isVisible = this._isTabVisible(tab);
    });

    // Update visible tabs array
    this._visibleTabs = this._tabs.filter(tab => tab.isVisible);

    // Adjust selected tab index if current tab is now hidden
    const currentSelectedTab = this._tabs[this.selectedTabIndex];
    if (currentSelectedTab && !currentSelectedTab.isVisible) {
      // Find the first visible tab
      const firstVisibleTabIndex = this._visibleTabs.length > 0 ? 
        this._tabs.findIndex(tab => tab === this._visibleTabs[0]) : 0;
      this.selectedTabIndex = firstVisibleTabIndex;
    }

    // Update selected tab index to match visible tabs array
    if (this._visibleTabs.length > 0) {
      const currentTab = this._tabs[this.selectedTabIndex];
      const visibleIndex = this._visibleTabs.findIndex(tab => tab === currentTab);
      if (visibleIndex >= 0) {
        this.selectedTabIndex = visibleIndex;
      }
    }
  }

  private _isTabVisible(tab: TabWithVisibility): boolean {
    if (!this._config?.options?.hideEmptyTabs) {
      return true;
    }

    const card = tab.card;
    
    // Check if card exists
    if (!card) return false;

    // Check different card types for content
    try {
      // For entity cards, check if entity exists and has a valid state
      if (card.tagName?.toLowerCase().includes('entity')) {
        const entityCard = card as any;
        if (entityCard.config?.entity) {
          const entity = this.hass?.states[entityCard.config.entity];
          return entity && entity.state !== 'unavailable' && entity.state !== 'unknown';
        }
      }

      // For entities cards (multiple entities), check if any entities exist
      if (card.tagName?.toLowerCase().includes('entities')) {
        const entitiesCard = card as any;
        if (entitiesCard.config?.entities?.length) {
          return entitiesCard.config.entities.some((entityConfig: any) => {
            const entityId = typeof entityConfig === 'string' ? entityConfig : entityConfig.entity;
            const entity = this.hass?.states[entityId];
            return entity && entity.state !== 'unavailable' && entity.state !== 'unknown';
          });
        }
      }

      // For conditional cards, check the conditions
      if (card.tagName?.toLowerCase().includes('conditional')) {
        const conditionalCard = card as any;
        if (conditionalCard.config?.conditions) {
          return this._evaluateConditions(conditionalCard.config.conditions);
        }
      }

      // For history-graph cards, check if entities exist
      if (card.tagName?.toLowerCase().includes('history-graph')) {
        const historyCard = card as any;
        if (historyCard.config?.entities?.length) {
          return historyCard.config.entities.some((entityId: string) => {
            const entity = this.hass?.states[entityId];
            return entity && entity.state !== 'unavailable' && entity.state !== 'unknown';
          });
        }
      }

      // For custom cards or other types, check if they have shadowRoot content
      if (card.shadowRoot) {
        const content = card.shadowRoot.textContent?.trim();
        return content && content.length > 0 && !content.includes('Entity not found');
      }

      // For cards with rendered content, check innerHTML
      if (card.innerHTML) {
        const content = card.innerHTML.trim();
        return content && content.length > 0 && !content.includes('Entity not found');
      }

      // Default to visible if we can't determine content
      return true;
    } catch (error) {
      console.warn('Error checking tab visibility:', error);
      return true; // Default to visible on error
    }
  }

  private _evaluateConditions(conditions: any[]): boolean {
    return conditions.every(condition => {
      const entity = this.hass?.states[condition.entity];
      if (!entity) return false;

      switch (condition.state_not) {
        case undefined:
          return condition.state ? entity.state === condition.state : true;
        default:
          return entity.state !== condition.state_not;
      }
    });
  }

  async _createTabs(config: TabbedCardConfig) {
    const tabs = await Promise.all(
      config.tabs.map(async (tab, index) => {
        const cardElement = await this._createCard(tab.card);
        return {
          styles: tab?.styles,
          attributes: { ...config?.attributes, ...tab?.attributes },
          card: cardElement,
          isVisible: true, // Will be updated in _updateTabVisibility
          originalIndex: index
        } as TabWithVisibility;
      }),
    );

    this._tabs = tabs;
    
    // Initialize visibility
    if (config?.options?.hideEmptyTabs) {
      this._updateTabVisibility();
    } else {
      this._visibleTabs = this._tabs;
    }

    // Set initial selected tab index
    const defaultIndex = config?.options?.defaultTabIndex || 0;
    if (config?.options?.hideEmptyTabs && this._visibleTabs.length > 0) {
      // Find the corresponding visible tab index
      const defaultTab = this._tabs[defaultIndex];
      const visibleIndex = this._visibleTabs.findIndex(tab => tab === defaultTab);
      this.selectedTabIndex = visibleIndex >= 0 ? visibleIndex : 0;
    } else {
      this.selectedTabIndex = Math.min(defaultIndex, this._tabs.length - 1);
    }
  }

  async _createCard(cardConfig: LovelaceCardConfig) {
    const cardElement = await this._helpers.createCardElement(cardConfig);

    cardElement.hass = this.hass;

    cardElement.addEventListener(
      "ll-rebuild",
      (ev: Event) => {
        ev.stopPropagation();
        this._rebuildCard(cardElement, cardConfig);
      },
      { once: true },
    );

    return cardElement;
  }

  async _rebuildCard(
    cardElement: LovelaceCard,
    cardConfig: LovelaceCardConfig,
  ) {
    console.log("_rebuildCard: ", cardElement, cardConfig);

    const newCardElement = await this._helpers.createCardElement(cardConfig);
    newCardElement.hass = this.hass;

    cardElement.replaceWith(newCardElement);

    // Update the tabs array with the rebuilt card
    const tabIndex = this._tabs.findIndex(tab => tab.card === cardElement);
    if (tabIndex >= 0) {
      this._tabs[tabIndex].card = newCardElement;
      
      // Re-evaluate visibility after rebuild
      if (this._config?.options?.hideEmptyTabs) {
        this._updateTabVisibility();
      }
    }
  }

  private _onTabActivated(ev: mwcTabBarEvent) {
    const visibleTabIndex = ev.detail.index;
    
    if (this._config?.options?.hideEmptyTabs) {
      // Map visible tab index back to actual tab index
      const selectedVisibleTab = this._visibleTabs[visibleTabIndex];
      if (selectedVisibleTab) {
        this.selectedTabIndex = visibleTabIndex;
      }
    } else {
      this.selectedTabIndex = visibleTabIndex;
    }
  }

  render() {
    if (!this.hass || !this._config || !this._helpers || !this._tabs?.length) {
      return html``;
    }

    // Use visible tabs if hideEmptyTabs is enabled, otherwise use all tabs
    const tabsToRender = this._config?.options?.hideEmptyTabs ? this._visibleTabs : this._tabs;
    
    if (tabsToRender.length === 0) {
      return html`<div class="no-tabs">No content available</div>`;
    }

    return html`
      <mwc-tab-bar
        @MDCTabBar:activated=${this._onTabActivated}
        style=${styleMap(this._styles)}
        activeIndex=${this.selectedTabIndex}
      >
        ${tabsToRender.map(
          (tab) =>
            html`
              <mwc-tab
                style=${ifDefined(styleMap(tab?.styles || {}))}
                label="${tab?.attributes?.label || nothing}"
                ?hasImageIcon=${tab?.attributes?.icon}
                ?isFadingIndicator=${tab?.attributes?.isFadingIndicator}
                ?minWidth=${tab?.attributes?.minWidth}
                ?isMinWidthIndicator=${tab?.attributes?.isMinWidthIndicator}
                ?stacked=${tab?.attributes?.stacked}
              >
                ${tab?.attributes?.icon
                ? html`<ha-icon
                      slot="icon"
                      icon="${tab?.attributes?.icon}"
                    ></ha-icon>`
                : html``}
              </mwc-tab>
            `,
        )}
      </mwc-tab-bar>
      <section>
        <article>
          ${tabsToRender[this.selectedTabIndex]?.card}
        </article>
      </section>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "tabbed-card": TabbedCard;
  }
}

(window as any).customCards = (window as any).customCards || [];
(window as any).customCards.push({
  type: "tabbed-card",
  name: "Tabbed Card",
  description: "A tabbed card of cards with support for hiding empty tabs.",
});
