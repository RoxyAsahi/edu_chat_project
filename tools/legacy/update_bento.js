const fs = require('fs');

let html = fs.readFileSync('index.html', 'utf8');

const oldBento = `<div id="agentSettingsContainer" class="settings-stack hidden">
            <section class="settings-card">
              <h3>Identity</h3>
              <div class="identity-grid">
                <div class="avatar-editor">
                  <img id="agentAvatarPreview" src="assets/default_avatar.png" alt="avatar" />
                  <input id="agentAvatarInput" type="file" accept="image/*" />
                </div>
                <div class="field-grid">
                  <label>
                    <span>Name</span>
                    <input id="agentNameInput" type="text" />
                  </label>
                  <label>
                    <span>Model</span>
                    <input id="agentModel" type="text" />
                  </label>
                  <label>
                    <span>Temperature</span>
                    <input id="agentTemperature" type="number" min="0" max="2" step="0.1" />
                  </label>
                  <label>
                    <span>Context Tokens</span>
                    <input id="agentContextTokenLimit" type="number" min="1" step="1" />
                  </label>
                  <label>
                    <span>Max Output Tokens</span>
                    <input id="agentMaxOutputTokens" type="number" min="1" step="1" />
                  </label>
                  <label>
                    <span>Top P</span>
                    <input id="agentTopP" type="number" min="0" max="1" step="0.01" />
                  </label>
                  <label>
                    <span>Top K</span>
                    <input id="agentTopK" type="number" min="0" step="1" />
                  </label>
                </div>
              </div>
              <div class="radio-row">
                <span>Streaming</span>
                <label><input id="agentStreamOutputTrue" type="radio" name="agentStreamOutput" checked /> On</label>
                <label><input id="agentStreamOutputFalse" type="radio" name="agentStreamOutput" /> Off</label>
              </div>
              <input id="editingAgentId" type="hidden" />
            </section>

            <section class="settings-card">
              <h3>System Prompt</h3>
              <div id="systemPromptContainer"></div>
            </section>

            <section class="settings-card">
              <h3>Chat Styling</h3>
              <div class="field-grid">
                <label>
                  <span>Avatar Border</span>
                  <input id="agentAvatarBorderColor" type="color" value="#3d5a80" />
                </label>
                <label>
                  <span>Avatar Border Text</span>
                  <input id="agentAvatarBorderColorText" type="text" value="#3d5a80" />
                </label>
                <label>
                  <span>Name Color</span>
                  <input id="agentNameTextColor" type="color" value="#ffffff" />
                </label>
                <label>
                  <span>Name Color Text</span>
                  <input id="agentNameTextColorText" type="text" value="#ffffff" />
                </label>
              </div>
              <label>
                <span>Card CSS</span>
                <textarea id="agentCardCss" rows="3"></textarea>
              </label>
              <label>
                <span>Chat CSS</span>
                <textarea id="agentChatCss" rows="3"></textarea>
              </label>
              <label>
                <span>Custom CSS</span>
                <textarea id="agentCustomCss" rows="3"></textarea>
              </label>
              <div class="checkbox-row">
                <label><input id="disableCustomColors" type="checkbox" /> Disable custom colors</label>
                <label><input id="useThemeColorsInChat" type="checkbox" /> Use theme colors in chat</label>
              </div>
            </section>

            <section class="settings-card settings-card--compact">
              <button id="saveAgentSettingsBtn" class="accent-button">Save Agent</button>
            </section>
          </div>`;

const newBento = `<div id="agentSettingsContainer" class="settings-stack hidden">
            <!-- Card 1: Identity Profile (Span 2) -->
            <section class="settings-card bento-identity">
              <h3>Profile</h3>
              <div class="identity-grid">
                <div class="avatar-editor">
                  <img id="agentAvatarPreview" src="assets/default_avatar.png" alt="avatar" />
                  <input id="agentAvatarInput" type="file" accept="image/*" />
                </div>
                <div class="field-grid" style="grid-template-columns: 1fr;">
                  <label>
                    <span>Name</span>
                    <input id="agentNameInput" type="text" />
                  </label>
                  <label>
                    <span>Model</span>
                    <input id="agentModel" type="text" />
                  </label>
                </div>
              </div>
              <input id="editingAgentId" type="hidden" />
            </section>

            <!-- Card 2: System Prompt (Span 2) -->
            <section class="settings-card bento-prompt">
              <h3>System Prompt</h3>
              <div id="systemPromptContainer"></div>
            </section>

            <!-- Card 3: Model Parameters (Span 1) -->
            <section class="settings-card bento-params">
              <h3>Parameters</h3>
              <div class="field-grid" style="grid-template-columns: 1fr;">
                <label>
                  <span>Temperature</span>
                  <input id="agentTemperature" type="number" min="0" max="2" step="0.1" />
                </label>
                <label>
                  <span>Top P</span>
                  <input id="agentTopP" type="number" min="0" max="1" step="0.01" />
                </label>
                <label>
                  <span>Top K</span>
                  <input id="agentTopK" type="number" min="0" step="1" />
                </label>
              </div>
            </section>

            <!-- Card 4: Constraints & Streaming (Span 1) -->
            <section class="settings-card bento-limits">
              <h3>Constraints</h3>
              <div class="field-grid" style="grid-template-columns: 1fr;">
                <label>
                  <span>Context Tokens</span>
                  <input id="agentContextTokenLimit" type="number" min="1" step="1" />
                </label>
                <label>
                  <span>Max Output Tokens</span>
                  <input id="agentMaxOutputTokens" type="number" min="1" step="1" />
                </label>
              </div>
              <div class="radio-row" style="margin-top: 12px; font-weight: 500; font-size: 13px;">
                <span style="display:block; margin-bottom: 4px;">Streaming</span>
                <label><input id="agentStreamOutputTrue" type="radio" name="agentStreamOutput" checked /> On</label>
                <label><input id="agentStreamOutputFalse" type="radio" name="agentStreamOutput" /> Off</label>
              </div>
            </section>

            <!-- Card 5: Chat Styling (Span 2) -->
            <section class="settings-card bento-style">
              <h3>Chat Styling</h3>
              <div class="field-grid">
                <label>
                  <span>Avatar Border</span>
                  <input id="agentAvatarBorderColor" type="color" value="#3d5a80" />
                  <input id="agentAvatarBorderColorText" type="text" value="#3d5a80" style="display:none" />
                </label>
                <label>
                  <span>Name Color</span>
                  <input id="agentNameTextColor" type="color" value="#ffffff" />
                  <input id="agentNameTextColorText" type="text" value="#ffffff" style="display:none" />
                </label>
              </div>
              <label>
                <span>Card CSS</span>
                <textarea id="agentCardCss"
