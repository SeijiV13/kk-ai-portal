import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '@auth0/auth0-angular';
import { CopilotChat, CopilotKit } from '@copilotkit/angular';
import { firstValueFrom } from 'rxjs';

import { auth0Config } from './auth0.config';

type AgentInfo = {
  id: string;
  name?: string;
  description?: string;
};

type WorkflowInfo = {
  workflowId?: string;
  id?: string;
  name?: string;
  description?: string;
};

type WorkflowRunStatus = {
  runId: string;
  status?: string;
  updatedAt?: string;
};

type NavItem = {
  id: string;
  label: string;
  description: string;
  kind: 'agent' | 'workflow';
};

type ToolResponse<T> = {
  data: T;
};

type KnowledgeIndexStatus = {
  indexReady: boolean;
  indexedFiles: number;
  chunks: number;
  embeddingModel: string;
  indexPath: string;
  updatedAt: string | null;
  storage: 'postgres' | 'local-json';
};

type KnowledgeIndexSyncResult = KnowledgeIndexStatus & {
  updatedFiles: number;
  removedFiles: number;
};

type AuthTokenClaims = {
  scope?: string;
  permissions?: string[];
  roles?: string[];
  [claim: string]: unknown;
};

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, CopilotChat],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (isLoading$ | async) {
      <section class="auth-screen">
        <div class="auth-card">
          <p class="eyebrow">KadaKareer Console</p>
          <h1>Checking your session…</h1>
          <p>Hang tight while Auth0 verifies access.</p>
        </div>
      </section>
    } @else if (isAuthenticated$ | async) {
    <div class="shell">
      <aside class="sidebar">
        <div class="sidebar__header">
          <p class="eyebrow">KadaKareer Console</p>
          <h1>Agent Assistant Platform</h1>
          <p class="sidebar__copy">Chat with the knowledge agent, sync the Neon index, or run internal workflows.</p>
        </div>

        <section class="nav-section">
          <h2>Agents</h2>
          @if (isConsoleLoading()) {
            @for (_ of skeletonCards; track $index) {
              <div class="nav-card nav-card--skeleton">
                <span class="skeleton-line skeleton-line--short"></span>
                <span class="skeleton-line"></span>
              </div>
            }
          } @else {
            @for (agent of agentItems(); track agent.id) {
            <button
              type="button"
              class="nav-card"
              [class.nav-card--active]="selectedItem()?.id === agent.id"
              (click)="selectItem(agent)"
            >
              <span class="nav-card__title">{{ agent.label }}</span>
              <span class="nav-card__desc">{{ agent.description }}</span>
            </button>
            }
          }
        </section>

        <section class="nav-section">
          <h2>Workflows</h2>
          @if (isConsoleLoading()) {
            <div class="nav-card nav-card--skeleton">
              <span class="skeleton-line skeleton-line--short"></span>
              <span class="skeleton-line"></span>
            </div>
          } @else {
            @for (workflow of workflowItems(); track workflow.id) {
            <button
              type="button"
              class="nav-card"
              [class.nav-card--active]="selectedItem()?.id === workflow.id"
              (click)="selectItem(workflow)"
            >
              <span class="nav-card__title">{{ workflow.label }}</span>
              <span class="nav-card__desc">{{ workflow.description }}</span>
            </button>
            }
          }
        </section>

      </aside>

      <main class="content">
        <header class="content__header">
          @if (isConsoleLoading()) {
            <div class="header-skeleton">
              <span class="skeleton-line skeleton-line--eyebrow"></span>
              <span class="skeleton-line skeleton-line--title"></span>
              <span class="skeleton-line"></span>
            </div>
            <div class="header-actions">
              <span class="skeleton-button"></span>
              <span class="skeleton-button skeleton-button--wide"></span>
            </div>
          } @else {
            <div>
            <p class="eyebrow">{{ selectedItem()?.kind === 'workflow' ? 'Workflow Trigger' : 'Agent Chat' }}</p>
            <h2>{{ selectedItem()?.label ?? 'Loading…' }}</h2>
            </div>
            <div class="header-actions">
            @if (user$ | async; as user) {
              <span class="user-chip">{{ user.email ?? user.name ?? 'Signed in' }}</span>
            }
            @if (isKnowledgeAgent()) {
              <button type="button" class="refresh refresh--secondary" (click)="openIndexModal()">
                Knowledge Index
              </button>
            }
            <button type="button" class="refresh" (click)="refresh()">Refresh</button>
            <button type="button" class="refresh refresh--secondary" (click)="logout()">Log out</button>
            </div>
          }
        </header>

        @if (authError()) {
          <div class="run-result run-result--error">{{ authError() }}</div>
        }

        @if (selectedItem()?.kind === 'agent') {
          <section class="panel panel--chat">
            @if (isRuntimeReady()) {
              <copilot-chat
                [agentId]="selectedItem()!.id"
                [threadId]="selectedAgentThreadId()"
              ></copilot-chat>
            } @else {
              <div class="chat-skeleton">
                <div class="message-skeleton message-skeleton--assistant">
                  <span class="skeleton-line"></span>
                  <span class="skeleton-line skeleton-line--wide"></span>
                  <span class="skeleton-line skeleton-line--medium"></span>
                </div>
                <div class="message-skeleton message-skeleton--user">
                  <span class="skeleton-line"></span>
                  <span class="skeleton-line skeleton-line--medium"></span>
                </div>
                <div class="message-skeleton message-skeleton--assistant">
                  <span class="skeleton-line skeleton-line--wide"></span>
                  <span class="skeleton-line"></span>
                </div>
                <div class="input-skeleton">
                  <span class="skeleton-line skeleton-line--wide"></span>
                  <span class="skeleton-button"></span>
                </div>
              </div>
            }
          </section>
        } @else if (selectedItem()?.kind === 'workflow') {
          <section class="panel panel--workflow">
            <div class="workflow-form">
              <label>
                <span>Sprint name</span>
                <select [(ngModel)]="workflowInput.sprintName" name="sprintName">
                  <option value="Sprint Q3.26.1">Sprint Q3.26.1</option>
                  <option value="Sprint Q3.26.2">Sprint Q3.26.2</option>
                  <option value="Sprint Q3.26.3">Sprint Q3.26.3</option>
                  <option value="Sprint Q3.26.4">Sprint Q3.26.4</option>
                </select>
              </label>

              <label>
                <span>Asana project</span>
                <select [(ngModel)]="workflowInput.asanaProject" name="asanaProject" (ngModelChange)="syncReleaseDestination($event)">
                  <option value="Programs">Programs</option>
                  <option value="KoachEx">KoachEx</option>
                </select>
              </label>

              <label>
                <span>Slack destination</span>
                <select [(ngModel)]="workflowInput.slackWebhook" name="slackWebhook" (ngModelChange)="syncReleaseDestination($event)">
                  <option value="Programs">Programs</option>
                  <option value="KoachEx">KoachEx</option>
                </select>
              </label>

              <label>
                <span>Completed since</span>
                <input [(ngModel)]="workflowInput.completedSince" name="completedSince" type="datetime-local" />
              </label>

              <label>
                <span>Sprint field name</span>
                <input [(ngModel)]="workflowInput.sprintFieldName" name="sprintFieldName" type="text" />
              </label>

              <label>
                <span>Done section name</span>
                <input [(ngModel)]="workflowInput.doneSectionName" name="doneSectionName" type="text" />
              </label>

              <label class="workflow-form__check">
                <input [(ngModel)]="workflowInput.includeTaskLinks" name="includeTaskLinks" type="checkbox" />
                <span>Include task links in the rendered release note</span>
              </label>
            </div>

            <div class="workflow-actions">
              <button type="button" class="run" (click)="triggerWorkflow()" [disabled]="isTriggering()">
                {{ isTriggering() ? 'Running…' : 'Run workflow' }}
              </button>
              <p class="workflow-hint">This uses Mastra's workflow run APIs directly.</p>
            </div>

            @if (workflowRunId()) {
              <div class="run-result">
                <div class="run-result__header">
                  <strong>Last run ID</strong>
                  @if (workflowStatus()) {
                    <span class="status-pill">{{ workflowStatus() }}</span>
                  }
                </div>
                <code>{{ workflowRunId() }}</code>
              </div>
            }

            @if (workflowError()) {
              <div class="run-result run-result--error">{{ workflowError() }}</div>
            }
          </section>
        }
      </main>
    </div>

    @if (isIndexModalOpen()) {
      <div class="modal-backdrop" (click)="closeIndexModal()">
        <section class="panel index-modal" (click)="$event.stopPropagation()" role="dialog" aria-modal="true" aria-label="Knowledge index status">
          <div class="index-modal__header">
            <div>
              <p class="eyebrow">Knowledge Index</p>
              <h3>{{ indexStatus()?.indexReady ? 'Neon index ready' : 'Index needs sync' }}</h3>
              <p>
                {{ indexStatus()?.storage === 'postgres' ? 'Using Neon/Postgres pgvector for semantic search.' : 'Using local JSON fallback for semantic search.' }}
              </p>
            </div>
            <button type="button" class="modal-close" (click)="closeIndexModal()" aria-label="Close knowledge index popup">×</button>
          </div>

          <div class="index-metrics">
            <span><strong>{{ indexStatus()?.indexedFiles ?? 0 }}</strong> files</span>
            <span><strong>{{ indexStatus()?.chunks ?? 0 }}</strong> chunks</span>
            <span><strong>{{ indexStatus()?.embeddingModel ?? '—' }}</strong> model</span>
          </div>

          <div class="index-actions">
            <button type="button" class="run" (click)="syncKnowledgeIndex()" [disabled]="isSyncingIndex()">
              {{ isSyncingIndex() ? 'Syncing…' : 'Sync index' }}
            </button>
            <button type="button" class="refresh refresh--secondary" (click)="loadIndexStatus()">Check status</button>
          </div>

          @if (indexStatus()?.updatedAt) {
            <p class="index-note">Last updated {{ indexStatus()!.updatedAt | date: 'medium' }}</p>
          }

          @if (indexMessage()) {
            <div class="run-result">{{ indexMessage() }}</div>
          }

          @if (indexError()) {
            <div class="run-result run-result--error">{{ indexError() }}</div>
          }
        </section>
      </div>
    }
    } @else {
      <section class="auth-screen">
        <div class="auth-card">
          <p class="eyebrow">KadaKareer Console</p>
          <h1>Sign in to continue</h1>
          <p>Access is invite-only. An admin must add your account in Auth0 before you can use this console.</p>
          @if (authError()) {
            <div class="run-result run-result--error">{{ authError() }}</div>
          }
          <button type="button" class="run" (click)="login()">Log in with Auth0</button>
        </div>
      </section>
    }
  `,
  styles: `
    .shell {
      display: grid;
      grid-template-columns: 320px 1fr;
      min-height: 100vh;
      gap: 24px;
      padding: 24px;
    }

    .auth-screen {
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 24px;
    }

    .auth-card {
      width: min(520px, 100%);
      background: var(--panel);
      border: 2px solid var(--border);
      box-shadow: var(--shadow);
      border-radius: 28px;
      padding: 32px;
      display: flex;
      flex-direction: column;
      gap: 16px;
      text-align: left;
    }

    .auth-card h1,
    .auth-card p {
      margin: 0;
    }

    .sidebar,
    .panel,
    .content__header {
      background: var(--panel);
      border: 2px solid var(--border);
      box-shadow: var(--shadow);
    }

    .sidebar {
      border-radius: 0 28px 28px 0;
      padding: 24px;
      display: flex;
      flex-direction: column;
      gap: 24px;
    }

    .sidebar::before {
      content: 'KadaKareer';
      display: inline-flex;
      align-self: flex-start;
      margin-bottom: 4px;
      color: var(--blue);
      font-weight: 900;
      font-size: 1.05rem;
    }

    .sidebar__header h1,
    .content__header h2 {
      margin: 0;
      font-size: 1.35rem;
      line-height: 1.05;
    }

    .sidebar__copy,
    .content__header p,
    .nav-card__desc,
    .workflow-hint {
      color: var(--muted);
    }

    .eyebrow {
      margin: 0 0 8px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-size: 0.72rem;
      color: var(--orange);
      font-weight: 900;
    }

    .nav-section {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .nav-section h2 {
      margin: 0 0 4px;
      font-size: 0.94rem;
      color: var(--blue);
    }

    .nav-card {
      text-align: left;
      border: 2px solid var(--border);
      background: var(--panel-strong);
      border-radius: 22px;
      padding: 14px;
      cursor: pointer;
      display: flex;
      flex-direction: column;
      gap: 6px;
      transition: transform 180ms ease, box-shadow 180ms ease, background 180ms ease;
    }

    .nav-card:hover,
    .nav-card--active {
      transform: translate(-2px, -2px);
      box-shadow: 5px 5px 0 #111111;
      background: var(--accent-soft);
    }

    .nav-card--active {
      background: var(--yellow);
    }

    .nav-card__title {
      font-weight: 900;
    }

    .nav-card--skeleton {
      cursor: default;
      transform: none !important;
      box-shadow: none !important;
    }

    .skeleton-line,
    .skeleton-button {
      display: block;
      border-radius: 999px;
      background: linear-gradient(90deg, rgba(7, 82, 125, 0.14), rgba(255, 216, 77, 0.42), rgba(7, 82, 125, 0.14));
      background-size: 220% 100%;
      animation: skeleton-shimmer 1.25s ease-in-out infinite;
    }

    .skeleton-line {
      width: 100%;
      height: 12px;
    }

    .skeleton-line--short {
      width: 44%;
      height: 16px;
    }

    .skeleton-line--medium {
      width: 68%;
    }

    .skeleton-line--wide {
      width: 86%;
    }

    .skeleton-line--eyebrow {
      width: 120px;
      height: 10px;
    }

    .skeleton-line--title {
      width: min(380px, 78vw);
      height: 28px;
      border-radius: 14px;
    }

    .skeleton-button {
      width: 92px;
      height: 46px;
      border: 2px solid var(--border);
      box-shadow: 4px 4px 0 #111111;
    }

    .skeleton-button--wide {
      width: 150px;
    }

    .header-skeleton {
      display: flex;
      flex-direction: column;
      gap: 10px;
      flex: 1;
    }

    @keyframes skeleton-shimmer {
      0% { background-position: 120% 0; }
      100% { background-position: -120% 0; }
    }

    .content {
      display: grid;
      grid-template-rows: auto 1fr;
      gap: 10px;
      min-width: 0;
    }

    .content__header {
      position: sticky;
      top: 16px;
      z-index: 8;
      border-radius: 18px;
      padding: 10px 14px;
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: center;
    }

    .content__header .eyebrow {
      margin-bottom: 4px;
      font-size: 0.62rem;
    }

    .header-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }

    .user-chip {
      border: 2px solid var(--border);
      border-radius: 999px;
      background: var(--yellow);
      padding: 6px 10px;
      font-size: 0.78rem;
      font-weight: 900;
      max-width: 240px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .refresh,
    .run {
      border: 2px solid var(--border);
      background: var(--orange);
      color: white;
      border-radius: 0;
      padding: 9px 13px;
      font-weight: 900;
      cursor: pointer;
      box-shadow: 4px 4px 0 #111111;
      transition: transform 160ms ease, box-shadow 160ms ease;
    }

    .refresh:hover,
    .run:hover {
      transform: translate(-1px, -1px);
      box-shadow: 5px 5px 0 #111111;
    }

    .refresh {
      background: var(--orange);
    }

    .refresh--secondary {
      background: var(--panel-strong);
      color: var(--text);
    }

    .panel {
      border-radius: 28px;
      padding: 20px;
      min-height: 0;
    }

    .panel--chat {
      background: transparent;
      border: 0;
      box-shadow: none;
      padding: 0;
    }

    .panel--chat {
      overflow: hidden;
      height: calc(100vh - 118px);
      display: flex;
      flex-direction: column;
    }

    .panel--chat copilot-chat {
      display: block;
      height: 100%;
      min-height: 0;
      overflow: hidden;
      flex: 1;
    }

    .chat-loading,
    .chat-skeleton {
      height: 100%;
    }

    .chat-loading {
      display: grid;
      place-content: center;
      text-align: center;
      gap: 8px;
    }

    .chat-loading p,
    .chat-loading strong {
      margin: 0;
    }

    .chat-skeleton {
      display: flex;
      flex-direction: column;
      gap: 18px;
      justify-content: flex-end;
    }

    .message-skeleton {
      display: flex;
      flex-direction: column;
      gap: 10px;
      max-width: min(620px, 82%);
      padding: 16px;
      border: 2px solid var(--border);
      border-radius: 22px;
      box-shadow: 4px 4px 0 #111111;
      background: var(--blue);
    }

    .message-skeleton--user {
      align-self: flex-end;
      background: var(--orange);
      max-width: min(480px, 76%);
    }

    .message-skeleton--assistant {
      align-self: flex-start;
    }

    .input-skeleton {
      margin-top: auto;
      display: grid;
      grid-template-columns: 1fr auto;
      align-items: center;
      gap: 12px;
      padding: 14px;
      border-top: 2px solid var(--border);
      background: white;
    }

    .panel--chat ::ng-deep [data-copilotkit] {
      min-height: 0;
      max-height: 100%;
    }

    .panel--chat ::ng-deep copilot-chat-view,
    .panel--chat ::ng-deep copilot-chat-view-scroll-view {
      min-height: 0 !important;
      max-height: 100% !important;
      overflow: hidden !important;
    }

    .panel--chat ::ng-deep copilot-chat-view-scroll-view > div,
    .panel--chat ::ng-deep .cpk\:h-full.cpk\:max-h-full {
      min-height: 0 !important;
      max-height: 100% !important;
      overflow-y: auto !important;
      overflow-x: hidden !important;
      padding-bottom: 40px !important;
      scroll-padding-bottom: 120px;
    }

    .panel--chat ::ng-deep copilot-chat-view-input-container {
      display: block !important;
      flex: 0 0 auto !important;
      position: relative !important;
      z-index: 3;
      background: #ffffff;
      border-top: 2px solid var(--border);
      padding-top: 16px;
      margin-top: 16px;
    }

    .panel--chat ::ng-deep copilot-chat-input {
      flex-shrink: 0;
      position: relative;
      z-index: 2;
      background: #ffffff;
    }

    .panel--chat ::ng-deep .copilotKitMessage,
    .panel--chat ::ng-deep .copilotKitMessage *,
    .panel--chat ::ng-deep [data-message-role],
    .panel--chat ::ng-deep [data-message-role] * {
      overflow-wrap: anywhere;
      word-break: break-word;
      max-width: 100%;
    }
    .panel--chat ::ng-deep [data-message-role="assistant"]:not(:has(copilot-chat-assistant-message-renderer)):not(:has(copilot-chat-tool-calls-view)) {
      display: none !important;
    }

    .panel--chat ::ng-deep .copilotKitAssistantMessage {
      background: #ffffff !important;
      color: var(--text) !important;
      border: 2px solid var(--border);
      border-radius: 22px;
      padding: 12px 16px;
    }

    .panel--chat ::ng-deep .copilotKitAssistantMessage *,
    .panel--chat ::ng-deep .copilotKitAssistantMessage .prose,
    .panel--chat ::ng-deep .copilotKitAssistantMessage .cpk\:prose {
      color: var(--text) !important;
    }

    .panel--chat ::ng-deep .copilotKitAssistantMessage a {
      color: var(--blue) !important;
      text-decoration: underline;
    }

    .panel--chat ::ng-deep .copilotKitAssistantMessage code,
    .panel--chat ::ng-deep .copilotKitAssistantMessage pre {
      background: var(--accent-soft);
      color: var(--text) !important;
      border: 1px solid var(--border);
      border-radius: 8px;
    }

    .panel--chat ::ng-deep copilot-chat-assistant-message-thumbs-up-button,
    .panel--chat ::ng-deep copilot-chat-assistant-message-thumbs-down-button {
      display: none !important;
    }

    .panel--chat ::ng-deep copilot-chat-assistant-message-copy-button,
    .panel--chat ::ng-deep copilot-chat-user-message-copy-button,
    .panel--chat ::ng-deep .code-block-copy-button {
      color: var(--blue) !important;
    }

    .panel--chat ::ng-deep copilot-chat-assistant-message-copy-button svg,
    .panel--chat ::ng-deep copilot-chat-user-message-copy-button svg,
    .panel--chat ::ng-deep .code-block-copy-button svg {
      color: var(--blue) !important;
      stroke: var(--blue) !important;
    }

    .panel--chat ::ng-deep copilot-chat-assistant-message-copy-button span,
    .panel--chat ::ng-deep copilot-chat-user-message-copy-button span,
    .panel--chat ::ng-deep .code-block-copy-button span {
      color: var(--blue) !important;
    }

    .panel--chat ::ng-deep pre,
    .panel--chat ::ng-deep code {
      white-space: pre-wrap;
      overflow-x: auto;
      max-width: 100%;
    }

    .panel--workflow {
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    .modal-backdrop {
      position: fixed;
      inset: 0;
      z-index: 50;
      display: grid;
      place-items: center;
      padding: 24px;
      background: rgba(7, 82, 125, 0.62);
    }

    .index-modal {
      width: min(720px, 100%);
      max-height: min(760px, calc(100vh - 48px));
      overflow: auto;
      background: var(--purple);
      display: flex;
      flex-direction: column;
      gap: 18px;
    }

    .index-modal__header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
    }

    .index-modal h3,
    .index-modal p {
      margin: 0;
    }

    .modal-close {
      width: 42px;
      height: 42px;
      border: 2px solid var(--border);
      background: var(--yellow);
      color: var(--text);
      box-shadow: 4px 4px 0 #111111;
      font: inherit;
      font-size: 1.5rem;
      font-weight: 900;
      line-height: 1;
      cursor: pointer;
      flex: 0 0 auto;
    }

    .index-metrics,
    .index-actions {
      display: flex;
      gap: 10px;
      align-items: center;
      flex-wrap: wrap;
    }

    .index-metrics span {
      border: 2px solid var(--border);
      border-radius: 999px;
      padding: 8px 10px;
      background: var(--panel-strong);
      color: var(--muted);
      white-space: nowrap;
    }

    .index-metrics strong {
      color: var(--text);
    }

    .index-note,
    .index-modal .run-result {
      margin: 0;
    }

    .workflow-form {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 16px;
    }

    .workflow-form label {
      display: flex;
      flex-direction: column;
      gap: 8px;
      font-weight: 600;
    }

    .workflow-form input,
    .workflow-form select {
      border: 2px solid var(--border);
      border-radius: 0;
      padding: 12px 14px;
      background: white;
      color: var(--text);
      font: inherit;
    }

    .workflow-form__check {
      grid-column: 1 / -1;
      flex-direction: row !important;
      align-items: center;
    }

    .workflow-actions {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
    }

    .run-result {
      border-radius: 18px;
      padding: 14px;
      background: var(--accent-soft);
      border: 2px solid var(--border);
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .run-result__header {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: center;
    }

    .status-pill {
      border: 1px solid var(--border);
      border-radius: 999px;
      background: white;
      color: var(--blue);
      padding: 3px 9px;
      font-size: 0.75rem;
      font-weight: 900;
      text-transform: uppercase;
    }

    .run-result--error {
      background: #ffe6e0;
      border-color: var(--border);
      color: #7b1e1e;
    }

    code {
      white-space: pre-wrap;
      word-break: break-word;
    }

    @media (max-width: 960px) {
      .shell {
        grid-template-columns: 1fr;
      }

      .panel--chat {
        height: 70vh;
      }

      .workflow-form {
        grid-template-columns: 1fr;
      }

      .content__header,
      .workflow-actions {
        flex-direction: column;
        align-items: flex-start;
      }
    }
  `,
})
export class AppComponent {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly copilotKit = inject(CopilotKit);
  private readonly chatSessionId = crypto.randomUUID();
  private readonly mastraApiBaseUrl = 'http://localhost:8200/api/mastra';
  private readonly hiddenAgentIds = new Set(['knowledge-base-agent-input-processor']);
  private readonly hiddenWorkflowIds = new Set(['knowledge-base-agent-input-processor']);
  protected readonly skeletonCards = Array.from({ length: 3 });

  protected readonly isLoading$ = this.auth.isLoading$;
  protected readonly isAuthenticated$ = this.auth.isAuthenticated$;
  protected readonly user$ = this.auth.user$;

  protected readonly agents = signal<AgentInfo[]>([]);
  protected readonly workflows = signal<WorkflowInfo[]>([]);
  protected readonly selectedItem = signal<NavItem | null>(null);
  protected readonly isTriggering = signal(false);
  protected readonly workflowRunId = signal('');
  protected readonly workflowStatus = signal('');
  protected readonly workflowError = signal('');
  protected readonly indexStatus = signal<KnowledgeIndexStatus | null>(null);
  protected readonly isSyncingIndex = signal(false);
  protected readonly isIndexModalOpen = signal(false);
  protected readonly isRuntimeReady = signal(false);
  protected readonly permissions = signal<Set<string>>(new Set());
  protected readonly allowedAgentIds = signal<Set<string>>(new Set());
  protected readonly allowedWorkflowIds = signal<Set<string>>(new Set());
  protected readonly indexMessage = signal('');
  protected readonly indexError = signal('');
  protected readonly authError = signal(this.getAuthErrorFromUrl());

  protected readonly agentItems = computed(() =>
    this.agents()
      .filter(agent => this.canSeeAgent(agent.id))
      .filter(agent => !this.hiddenAgentIds.has(agent.id))
      .map(agent => ({
        id: agent.id,
        label: agent.name ?? agent.id,
        description: agent.description ?? 'Chat with this Mastra agent through CopilotKit.',
        kind: 'agent' as const,
      })),
  );

  protected readonly workflowItems = computed(() =>
    this.workflows()
      .filter(workflow => this.canSeeWorkflow(workflow.workflowId ?? workflow.id ?? workflow.name ?? ''))
      .filter(workflow => !this.hiddenWorkflowIds.has(workflow.workflowId ?? workflow.id ?? workflow.name ?? ''))
      .map(workflow => ({
        id: workflow.workflowId ?? workflow.id ?? 'unknown-workflow',
        label: workflow.name ?? workflow.workflowId ?? workflow.id ?? 'Unnamed workflow',
        description: workflow.description ?? 'Run this workflow manually from the UI.',
        kind: 'workflow' as const,
      })),
  );

  protected readonly isKnowledgeAgent = computed(
    () => this.selectedItem()?.kind === 'agent' && this.selectedItem()?.id === 'knowledge-base-agent',
  );

  protected readonly selectedAgentThreadId = computed(() => {
    const item = this.selectedItem();
    return item?.kind === 'agent' ? `${this.chatSessionId}:${item.id}` : '';
  });

  protected readonly isConsoleLoading = computed(
    () => !this.isRuntimeReady() || !this.selectedItem(),
  );

  protected readonly workflowInput = {
    asanaProject: 'Programs',
    sprintName: 'Sprint Q3.26.1',
    sprintFieldName: 'Sprints',
    doneSectionName: 'Done',
    slackWebhook: 'Programs',
    completedSince: '',
    includeTaskLinks: true,
  };

  constructor() {
    this.isAuthenticated$.subscribe(async isAuthenticated => {
      if (isAuthenticated) {
        await this.configureAuthenticatedRuntime();
        void this.refresh();
      }
    });
  }

  private async configureAuthenticatedRuntime() {
    this.isRuntimeReady.set(false);
    const token = await firstValueFrom(
      this.auth.getAccessTokenSilently({
        cacheMode: 'off',
        authorizationParams: {
          audience: auth0Config.audience,
          scope: auth0Config.scope,
        },
      }),
    );

    this.copilotKit.updateRuntime({
      headers: token ? { 'x-auth0-token': token } : {},
    });

    if (token) {
      this.applyTokenClaims(token);
    }

    this.isRuntimeReady.set(true);
  }

  private applyTokenClaims(token: string) {
    try {
      const claims = this.decodeJwtClaims(token);
      const tokenPermissions = this.extractPermissionsFromClaims(claims);

      this.permissions.set(tokenPermissions);
      this.applyAllowedResources(tokenPermissions);
    } catch {
      // Diagnostics endpoint will surface token problems if local decoding fails.
    }
  }

  private applyAllowedResources(permissions: Set<string>) {
    const isAdmin = permissions.has('admin');
    this.allowedAgentIds.set(new Set([
      ...(isAdmin || permissions.has('knowledge-agent:chat') ? ['knowledge-base-agent'] : []),
      ...(isAdmin || permissions.has('asana-agent:chat') ? ['asana-agent'] : []),
      ...(isAdmin ? ['release-notes-agent'] : []),
    ]));
    this.allowedWorkflowIds.set(new Set([
      ...(isAdmin || permissions.has('release-notes:execute') ? ['asanaReleaseNotesWorkflow', 'asana-release-notes-workflow'] : []),
    ]));
  }

  private decodeJwtClaims(token: string): AuthTokenClaims {
    const payload = token.split('.')[1] ?? '';
    const normalizedPayload = payload.replace(/-/g, '+').replace(/_/g, '/');
    const paddedPayload = normalizedPayload.padEnd(Math.ceil(normalizedPayload.length / 4) * 4, '=');
    return JSON.parse(atob(paddedPayload)) as AuthTokenClaims;
  }

  private extractPermissionsFromClaims(claims: AuthTokenClaims) {
    const namespace = `${auth0Config.audience}/`;
    const legacyNamespace = 'https://kadakareer.com/';
    const rawValues = [
      claims.permissions,
      claims.roles,
      claims[`${namespace}permissions`],
      claims[`${namespace}roles`],
      claims[`${legacyNamespace}permissions`],
      claims[`${legacyNamespace}roles`],
      claims.scope,
    ];
    const normalized = rawValues.flatMap(value => this.normalizeClaimValues(value));
    const roleAliases: Record<string, string[]> = {
      Administrator: ['admin'],
      Admin: ['admin'],
      'Console Admin': ['admin'],
      'Knowledge Agent User': ['knowledge-agent:chat'],
      'Asana Agent User': ['asana-agent:chat'],
      'Release Notes User': ['release-notes:execute'],
    };

    return new Set(normalized.flatMap(value => [value, ...(roleAliases[value] ?? [])]));
  }

  private normalizeClaimValues(value: unknown): string[] {
    if (Array.isArray(value)) {
      return value.flatMap(item => this.normalizeClaimValues(item));
    }

    if (typeof value === 'string') {
      return value
        .split(/[\s,]+/)
        .map(item => item.trim())
        .filter(Boolean);
    }

    return [];
  }

  private getAuthErrorFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const error = params.get('error');
    const description = params.get('error_description');
    return [error, description].filter(Boolean).join(': ');
  }

  protected login() {
    void this.auth.loginWithRedirect({
      authorizationParams: {
        audience: auth0Config.audience,
        scope: auth0Config.scope,
        screen_hint: 'login',
        connection: auth0Config.connection,
      },
    });
  }

  protected logout() {
    this.auth.logout({
      logoutParams: {
        returnTo: window.location.origin,
      },
    });
  }

  protected syncReleaseDestination(destination: 'Programs' | 'KoachEx') {
    this.workflowInput.asanaProject = destination;
    this.workflowInput.slackWebhook = destination;
  }

  protected selectItem(item: NavItem) {
    this.selectedItem.set(item);
    this.workflowRunId.set('');
    this.workflowStatus.set('');
    this.workflowError.set('');
    this.indexMessage.set('');
    this.indexError.set('');
    if (this.isKnowledgeAgent()) {
      void this.loadIndexStatus();
    }
  }

  protected async refresh() {
    const [agents, workflows] = await Promise.all([this.loadAgents(), this.loadWorkflows()]);
    this.agents.set(agents);
    this.workflows.set(workflows);

    if (!this.selectedItem()) {
      this.selectedItem.set(this.agentItems()[0] ?? this.workflowItems()[0] ?? null);
    }

    if (this.isKnowledgeAgent()) {
      await this.loadIndexStatus();
    }
  }

  protected async loadIndexStatus() {
    this.indexError.set('');

    try {
      const response = await this.executeMastraTool<KnowledgeIndexStatus>(
        'get_kadakareer_knowledge_index_status',
        {},
      );
      this.indexStatus.set(response);
    } catch {
      this.indexError.set('Unable to read the index status. Restart Mastra dev server if this tool was just added.');
    }
  }

  protected openIndexModal() {
    this.isIndexModalOpen.set(true);
    void this.loadIndexStatus();
  }

  protected closeIndexModal() {
    this.isIndexModalOpen.set(false);
  }

  protected async syncKnowledgeIndex() {
    this.isSyncingIndex.set(true);
    this.indexMessage.set('');
    this.indexError.set('');

    try {
      const result = await this.executeMastraTool<KnowledgeIndexSyncResult>(
        'sync_kadakareer_knowledge_index',
        { maxFiles: 200 },
      );
      this.indexStatus.set({
        indexReady: result.chunks > 0,
        indexedFiles: result.indexedFiles,
        chunks: result.chunks,
        embeddingModel: result.embeddingModel,
        indexPath: result.indexPath,
        updatedAt: result.updatedAt,
        storage: result.indexPath.startsWith('postgres://') ? 'postgres' : 'local-json',
      });
      this.indexMessage.set(`Synced ${result.updatedFiles} updated files, removed ${result.removedFiles}.`);
    } catch {
      this.indexError.set('Unable to sync the index. Check Drive auth, Neon connection, and Mastra server logs.');
    } finally {
      this.isSyncingIndex.set(false);
    }
  }

  protected async triggerWorkflow() {
    const workflowId = this.selectedItem()?.id;
    if (!workflowId) {
      return;
    }

    if (!this.canSeeWorkflow(workflowId)) {
      this.workflowError.set('You need release-notes:execute permission to run this workflow.');
      return;
    }

    this.isTriggering.set(true);
    this.workflowError.set('');

    try {
      const createRun = await this.mastraPost<{ runId: string }>(`/workflows/${workflowId}/create-run`, {});

      const runId = createRun.runId;
      this.workflowRunId.set(runId);
      this.workflowStatus.set('created');

      await this.mastraPost(`/workflows/${workflowId}/start-async?runId=${encodeURIComponent(runId)}`, {
        inputData: {
          ...this.workflowInput,
          completedSince: this.workflowInput.completedSince
            ? new Date(this.workflowInput.completedSince).toISOString()
            : undefined,
          },
      });
      this.workflowStatus.set('started');
      void this.pollWorkflowStatus(workflowId, runId);
    } catch (error) {
      this.workflowError.set(error instanceof Error ? error.message : 'Failed to trigger workflow.');
    } finally {
      this.isTriggering.set(false);
    }
  }

  private async pollWorkflowStatus(workflowId: string, runId: string, attempt = 0) {
    if (attempt > 60 || this.workflowRunId() !== runId) {
      return;
    }

    try {
      const result = await this.mastraGet<WorkflowRunStatus>(`/workflows/${workflowId}/runs/${runId}`);
      const status = result.status ?? 'unknown';
      this.workflowStatus.set(status);

      if (!['success', 'failed', 'canceled', 'cancelled', 'completed'].includes(status.toLowerCase())) {
        window.setTimeout(() => void this.pollWorkflowStatus(workflowId, runId, attempt + 1), 2000);
      }
    } catch {
      window.setTimeout(() => void this.pollWorkflowStatus(workflowId, runId, attempt + 1), 3000);
    }
  }

  private async loadAgents() {
    try {
      const response = await this.mastraGet<AgentInfo[] | Record<string, AgentInfo>>(
        `/agents?excludeAgentIds=${encodeURIComponent([...this.hiddenAgentIds].join(','))}`,
      );
      return this.toArray(response)
        .map((agent, index) => ({
          ...agent,
          id: agent.id ?? Object.keys(response)[index] ?? 'unknown-agent',
        }))
        .filter(agent => this.canSeeAgent(agent.id))
        .filter(agent => !this.hiddenAgentIds.has(agent.id));
    } catch {
      const fallbackAgents = [
        {
          id: 'knowledge-base-agent',
          name: 'KadaKareer Knowledge Agent',
          description: 'Expert on everything KadaKareer, grounded in the Neon knowledge index.',
        },
        {
          id: 'asana-agent',
          name: 'Asana Agent',
          description: 'Product manager style status assistant for Programs and KoachEx Asana boards.',
        },
        {
          id: 'release-notes-agent',
          name: 'Release Notes Agent',
          description: 'Summarizes sprint work into release notes.',
        },
      ];

      return fallbackAgents.filter(agent => this.canSeeAgent(agent.id));
    }
  }

  private async loadWorkflows() {
    try {
      const response = await this.mastraGet<WorkflowInfo[] | Record<string, WorkflowInfo>>(
        `/workflows?excludeWorkflowIds=${encodeURIComponent([...this.hiddenWorkflowIds].join(','))}`,
      );
      return this.toArray(response)
        .map((workflow, index) => ({
          ...workflow,
          workflowId: workflow.workflowId ?? workflow.id ?? Object.keys(response)[index] ?? 'unknown-workflow',
        }))
        .filter(workflow => this.canSeeWorkflow(workflow.workflowId ?? workflow.id ?? workflow.name ?? ''))
        .filter(workflow => !this.hiddenWorkflowIds.has(workflow.workflowId ?? workflow.id ?? workflow.name ?? ''));
    } catch {
      return [
        {
          workflowId: 'asanaReleaseNotesWorkflow',
          name: 'Asana Release Notes Workflow',
          description: 'Collects sprint tickets from Asana and publishes release notes.',
        },
      ];
    }
  }

  private unwrapToolResponse<T>(response: ToolResponse<T> | T) {
    return 'data' in (response as ToolResponse<T>) ? (response as ToolResponse<T>).data : (response as T);
  }

  private async executeMastraTool<T>(toolId: string, data: Record<string, unknown>) {
    const response = await this.mastraPost<ToolResponse<T> | T>(`/tools/${toolId}/execute`, { data });
    return this.unwrapToolResponse(response as ToolResponse<T> | T);
  }

  private async getAuthHeaders(): Promise<Record<string, string>> {
    const token = await firstValueFrom(
      this.auth.getAccessTokenSilently({
        cacheMode: 'off',
        authorizationParams: {
          audience: auth0Config.audience,
          scope: auth0Config.scope,
        },
      }),
    );

    if (!token) {
      throw new Error('Auth0 did not return an access token.');
    }

    return { Authorization: `Bearer ${token}` };
  }

  private hasPermission(permission: string) {
    const permissions = this.permissions();
    console.log('Permissions:', permissions);
    return permissions.has('admin') || permissions.has(permission);
  }

  private canSeeAgent(agentId: string) {
    return this.hasPermission('admin') || this.allowedAgentIds().has(agentId);
  }

  private canSeeWorkflow(workflowId: string) {
    return this.hasPermission('admin') || this.allowedWorkflowIds().has(workflowId);
  }

  private async mastraGet<T>(path: string) {
    return firstValueFrom(
      this.http.get<T>(`${this.mastraApiBaseUrl}${path}`, {
        headers: await this.getAuthHeaders(),
      }),
    );
  }

  private async mastraPost<T>(path: string, body: unknown) {
    return firstValueFrom(
      this.http.post<T>(`${this.mastraApiBaseUrl}${path}`, body, {
        headers: await this.getAuthHeaders(),
      }),
    );
  }

  private toArray<T>(response: T[] | Record<string, T>) {
    return Array.isArray(response) ? response : Object.values(response);
  }
}