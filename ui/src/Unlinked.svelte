<script>
  import { createEventDispatcher, onMount } from "svelte";
  import UserAvatar from "./lib/UserAvatar.svelte";

  export let users = [];

  const dispatch = createEventDispatcher();

  let measurements = [];
  let isLoading = true;
  let error = "";
  let assigning = {};
  let creatingUser = false;
  let newUserName = "";

  function createDateTimeFormatter(primaryOptions, fallbackOptions) {
    try {
      return new Intl.DateTimeFormat(undefined, primaryOptions);
    } catch {
      return new Intl.DateTimeFormat(undefined, fallbackOptions);
    }
  }

  const dateFormatter = createDateTimeFormatter(
    {
      dateStyle: "medium",
      timeStyle: "short"
    },
    {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }
  );

  onMount(() => {
    void loadUnlinked();
  });

  async function loadUnlinked() {
    isLoading = true;
    error = "";
    try {
      const res = await fetch("/api/ui/unlinked");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const payload = await res.json();
      measurements = payload.measurements ?? [];
    } catch (e) {
      error = e instanceof Error ? e.message : "Failed to load";
    } finally {
      isLoading = false;
    }
  }

  $: claimableUsers = users;
  $: hasUsers = claimableUsers.length > 0;

  async function createUser() {
    const screenName = newUserName.trim();
    if (!screenName) {
      error = "Enter a screen name first";
      return;
    }

    creatingUser = true;
    error = "";

    try {
      const res = await fetch("/api/ui/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ screenName })
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const payload = await res.json();
      dispatch("usercreated", { userId: payload.userId, screenName });
      newUserName = "";
    } catch (e) {
      error = e instanceof Error ? e.message : "Create user failed";
    } finally {
      creatingUser = false;
    }
  }

  async function assign(measurementId, userId) {
    assigning = { ...assigning, [measurementId]: userId };
    try {
      const res = await fetch(`/api/ui/unlinked/${measurementId}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      measurements = measurements.filter((m) => m.id !== measurementId);
      dispatch("assigned", { measurementId, userId, remaining: measurements.length });
    } catch (e) {
      error = e instanceof Error ? e.message : "Assign failed";
    } finally {
      const next = { ...assigning };
      delete next[measurementId];
      assigning = next;
    }
  }
</script>

<div class="page">
  <header class="page-header">
    <button class="back-btn" on:click={() => dispatch("back")} aria-label="Back to dashboard">
      ← Back
    </button>
    <div>
      <p class="eyebrow">Measurements</p>
      <h1>Unlinked</h1>
    </div>
  </header>

  {#if isLoading}
    <div class="status-card">Loading…</div>
  {:else if error}
    <div class="status-card error">{error}</div>
  {:else if measurements.length === 0}
    {#if hasUsers}
      <div class="status-card">
        Stand on the scale to record the first measurement, then assign it to your user profile.
      </div>
    {:else}
      <div class="status-card">
        Create a user first, then stand on the scale to record and assign the first measurement.
      </div>
    {/if}
  {:else}
    <p class="hint">
      These measurements were not matched to an existing user by weight average. Create a user, then tap an avatar to claim each measurement.
    </p>

    <form class="create-user" on:submit|preventDefault={createUser}>
      <input
        type="text"
        bind:value={newUserName}
        placeholder="New user name"
        maxlength="64"
        aria-label="New user name"
      />
      <button type="submit" disabled={creatingUser || !newUserName.trim()}>
        {creatingUser ? "Creating..." : "Create user"}
      </button>
    </form>

    <ul class="measure-list">
      {#each measurements as m (m.id)}
        <li class="measure-row">
          <div class="measure-info">
            <strong>{m.weightKg.toFixed(1)} kg</strong>
            <span>{dateFormatter.format(new Date(m.measuredAt * 1000))}</span>
            {#if m.macAddress}
              <small>{m.macAddress}</small>
            {/if}
          </div>

          <div class="user-buttons" aria-label="Assign to user">
            {#if claimableUsers.length === 0}
              <span class="no-users">Create a user to claim measurements.</span>
            {:else}
              {#each claimableUsers as user (user.userId)}
              <button
                class="avatar-btn"
                class:busy={assigning[m.id] === user.userId}
                disabled={!!assigning[m.id]}
                on:click={() => assign(m.id, user.userId)}
                title="Assign to {user.screenName}"
              >
                <UserAvatar screenName={user.screenName} size={40} />
              </button>
              {/each}
            {/if}
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .page {
    max-width: 920px;
    margin: 0 auto;
    padding: 20px 16px 40px;
  }

  .page-header {
    display: flex;
    align-items: flex-start;
    gap: 14px;
    margin-bottom: 20px;
  }

  .back-btn {
    margin-top: 6px;
    padding: 10px 16px;
    border: 1px solid var(--stroke);
    border-radius: 14px;
    background: var(--panel);
    color: var(--accent);
    cursor: pointer;
    font-size: 0.9rem;
    white-space: nowrap;
  }

  .eyebrow {
    margin: 0;
    font-size: 0.74rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted);
  }

  h1 {
    margin: 4px 0 0;
    font-size: clamp(1.8rem, 5vw, 2.8rem);
    line-height: 1;
  }

  .hint {
    color: var(--muted);
    font-size: 0.9rem;
    margin: 0 0 16px;
  }

  .create-user {
    display: flex;
    gap: 10px;
    margin-bottom: 16px;
  }

  .create-user input {
    flex: 1;
    min-width: 170px;
    border: 1px solid var(--stroke);
    border-radius: 12px;
    padding: 10px 12px;
    font: inherit;
    color: inherit;
    background: var(--panel);
  }

  .create-user button {
    border: 1px solid var(--stroke);
    border-radius: 12px;
    padding: 10px 14px;
    font: inherit;
    background: var(--panel);
    color: var(--accent);
    cursor: pointer;
  }

  .create-user button:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .status-card {
    padding: 20px;
    border: 1px solid var(--stroke);
    border-radius: 18px;
    background: var(--panel);
    color: var(--muted);
  }

  .status-card.error {
    color: var(--danger);
  }

  .measure-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .measure-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 14px 16px;
    border: 1px solid var(--stroke);
    border-radius: 18px;
    background: var(--panel);
    box-shadow: var(--surface-shadow);
  }

  .measure-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .measure-info strong {
    font-size: 1.1rem;
  }

  .measure-info span,
  .measure-info small {
    color: var(--muted);
    font-size: 0.82rem;
  }

  .user-buttons {
    display: flex;
    gap: 8px;
    flex-shrink: 0;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .no-users {
    color: var(--muted);
    font-size: 0.82rem;
  }

  .avatar-btn {
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    opacity: 1;
    transition: opacity 0.15s, transform 0.15s;
  }

  .avatar-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .avatar-btn.busy {
    opacity: 0.4;
  }

  .avatar-btn:not(:disabled):hover :global(.avatar) {
    transform: scale(1.1);
  }
</style>
