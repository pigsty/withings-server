<script>
  import { onMount } from "svelte";
  import MetricChart from "./lib/MetricChart.svelte";
  import UserAvatar from "./lib/UserAvatar.svelte";
  import Unlinked from "./Unlinked.svelte";

  const PROFILE_FALLBACKS = {
    heightM: 1.8,
    ageYears: 40,
    sex: 1
  };

  const RANGE_LABELS = {
    month: "Month",
    quarter: "Quarter",
    year: "Year"
  };

  let users = [];
  let selectedUserId;
  let measurements = [];
  let selectedMeasurementId;
  let rangeMode = "quarter";
  let anchorDate = new Date();
  let isLoadingUsers = true;
  let isLoadingMeasurements = false;
  let unlinkedCount = 0;
  let page = "home";
  let usersError = "";
  let measurementsError = "";
  let currentMeasurementsAbort;
  let profileDraftForUserId;
  let profileDraft = {
    screenName: "",
    externalUserId: "",
    profileWeightKg: "",
    profileHeightM: "",
    profileAgeYears: "",
    profileSex: ""
  };
  let isSavingProfile = false;
  let profileSaveError = "";
  let profileSaveSuccess = "";
  let isCreatingUserFromDashboard = false;
  let dashboardCreateError = "";
  let isUnlinkingMeasurement = false;
  let unlinkError = "";

  function createDateTimeFormatter(primaryOptions, fallbackOptions) {
    try {
      return new Intl.DateTimeFormat(undefined, primaryOptions);
    } catch {
      return new Intl.DateTimeFormat(undefined, fallbackOptions);
    }
  }

  const dateFormatter = createDateTimeFormatter(
    {
      month: "short",
      day: "numeric"
    },
    {
      month: "short",
      day: "numeric"
    }
  );

  const detailFormatter = createDateTimeFormatter(
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
    void loadUsers();
  });

  $: activeUser = users.find((user) => user.userId === selectedUserId);
  $: activeProfile = getProfile(activeUser);
  $: hasUsers = users.length > 0;
  $: hasAssignedMeasurements = users.some((user) => user.measurementCount > 0);
  $: showNoUsersOnboarding = !isLoadingUsers && !hasUsers;
  $: showFirstMeasurementOnboarding = !isLoadingUsers && hasUsers && !hasAssignedMeasurements && unlinkedCount === 0;
  $: showFirstAssignmentOnboarding = !isLoadingUsers && hasUsers && !hasAssignedMeasurements && unlinkedCount > 0;
  $: rangeWindow = getRangeWindow(anchorDate, rangeMode);
  $: chartMeasurements = measurements.map((measurement) => enrichMeasurement(measurement, activeProfile));
  $: selectedMeasurement =
    chartMeasurements.find((measurement) => measurement.id === selectedMeasurementId) ??
    chartMeasurements[chartMeasurements.length - 1];
  $: if (activeUser && profileDraftForUserId !== activeUser.userId) {
    profileDraftForUserId = activeUser.userId;
    profileDraft = {
      screenName: activeUser.screenName ?? "",
      externalUserId: activeUser.externalUserId == null ? "" : String(activeUser.externalUserId),
      profileWeightKg: activeUser.profileWeightKg == null ? "" : String(activeUser.profileWeightKg),
      profileHeightM: activeUser.profileHeightM == null ? "" : String(activeUser.profileHeightM),
      profileAgeYears: activeUser.profileAgeYears == null ? "" : String(activeUser.profileAgeYears),
      profileSex: activeUser.profileSex == null ? "" : String(activeUser.profileSex)
    };
    profileSaveError = "";
    profileSaveSuccess = "";
  }

  $: if (selectedUserId && rangeWindow.startUnix < rangeWindow.endUnix) {
    loadMeasurements(selectedUserId, rangeWindow);
  }

  async function loadUsers() {
    isLoadingUsers = true;
    usersError = "";

    try {
      const response = await fetch("/api/ui/users");
      if (!response.ok) {
        throw new Error(`Failed to load users (${response.status})`);
      }

      const payload = await response.json();
      users = payload.users ?? [];
      if (selectedUserId && !users.some((user) => user.userId === selectedUserId)) {
        selectedUserId = users[0]?.userId;
      }
      if (!selectedUserId && users.length) {
        selectedUserId = users[0].userId;
      }
      await loadUnlinkedCount();
    } catch (error) {
      usersError = error instanceof Error ? error.message : "Failed to load users";
    } finally {
      isLoadingUsers = false;
    }
  }

  async function loadUnlinkedCount() {
    try {
      const response = await fetch("/api/ui/unlinked");
      if (response.ok) {
        const payload = await response.json();
        unlinkedCount = (payload.measurements ?? []).length;
      }
    } catch {
      // best-effort, ignore
    }
  }

  async function loadMeasurements(userId, window) {
    currentMeasurementsAbort?.abort?.();
    currentMeasurementsAbort = typeof AbortController !== "undefined" ? new AbortController() : null;
    isLoadingMeasurements = true;
    measurementsError = "";

    try {
      const granularity = rangeMode === "year" ? "weekly" : rangeMode === "quarter" ? "daily" : "raw";
      const params = new URLSearchParams({
        start: String(window.startUnix),
        end: String(window.endUnix),
        granularity
      });
      const response = await fetch(
        `/api/ui/users/${userId}/measurements?${params.toString()}`,
        currentMeasurementsAbort?.signal
          ? { signal: currentMeasurementsAbort.signal }
          : undefined
      );

      if (!response.ok) {
        throw new Error(`Failed to load measurements (${response.status})`);
      }

      const payload = await response.json();
      measurements = payload.measurements ?? [];
      selectedMeasurementId = measurements[measurements.length - 1]?.id;
    } catch (error) {
      if (error?.name === "AbortError") {
        return;
      }
      measurementsError = error instanceof Error ? error.message : "Failed to load measurements";
    } finally {
      isLoadingMeasurements = false;
    }
  }

  function getRangeWindow(date, mode) {
    const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));

    if (mode === "month") {
      const start = new Date(Date.UTC(utc.getUTCFullYear(), utc.getUTCMonth(), 1));
      const end = new Date(Date.UTC(utc.getUTCFullYear(), utc.getUTCMonth() + 1, 1));
      return {
        start,
        end,
        startUnix: Math.floor(start.getTime() / 1000),
        endUnix: Math.floor(end.getTime() / 1000),
        label: start.toLocaleString(undefined, { month: "long", year: "numeric" })
      };
    }

    if (mode === "quarter") {
      const quarterMonth = Math.floor(utc.getUTCMonth() / 3) * 3;
      const start = new Date(Date.UTC(utc.getUTCFullYear(), quarterMonth, 1));
      const end = new Date(Date.UTC(utc.getUTCFullYear(), quarterMonth + 3, 1));
      const quarter = quarterMonth / 3 + 1;
      return {
        start,
        end,
        startUnix: Math.floor(start.getTime() / 1000),
        endUnix: Math.floor(end.getTime() / 1000),
        label: `Q${quarter} ${start.getUTCFullYear()}`
      };
    }

    const start = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
    const end = new Date(Date.UTC(utc.getUTCFullYear() + 1, 0, 1));
    return {
      start,
      end,
      startUnix: Math.floor(start.getTime() / 1000),
      endUnix: Math.floor(end.getTime() / 1000),
      label: String(start.getUTCFullYear())
    };
  }

  function shiftWindow(step) {
    const next = new Date(anchorDate);
    const monthDelta = rangeMode === "month" ? 1 : rangeMode === "quarter" ? 3 : 12;
    next.setUTCMonth(next.getUTCMonth() + step * monthDelta);
    anchorDate = next;
  }

  function getProfile(user) {
    return {
      heightM: user?.profileHeightM ?? PROFILE_FALLBACKS.heightM,
      ageYears: user?.profileAgeYears ?? PROFILE_FALLBACKS.ageYears,
      sex: user?.profileSex ?? PROFILE_FALLBACKS.sex
    };
  }

  function enrichMeasurement(measurement, profile) {
    const reValue = measurement.values.find((value) => value.type === 16)?.normalizedValue;
    const composition = calculateBodyComposition(measurement.weightKg, reValue, profile);

    return {
      ...measurement,
      reValue,
      composition,
      label: dateFormatter.format(new Date(measurement.measuredAt * 1000))
    };
  }

  function calculateBodyComposition(weightKg, resistance, profile) {
    if (!Number.isFinite(weightKg) || !Number.isFinite(resistance) || resistance <= 0) {
      return null;
    }

    const heightCm = profile.heightM * 100;
    const formulaSex = profile.sex === 0 ? 1 : 0;
    const tbw =
      0.372 * ((heightCm * heightCm) / resistance) +
      3.05 * formulaSex +
      0.142 * weightKg -
      0.069 * profile.ageYears;
    const fatFreeMassKg = tbw / 0.73;
    const rawFatMassKg = weightKg - fatFreeMassKg;
    const fatMassKg = clamp(rawFatMassKg, 0, weightKg);
    const fatPct = weightKg > 0 ? clamp((fatMassKg / weightKg) * 100, 0, 100) : 0;

    return {
      tbw,
      fatFreeMassKg,
      fatMassKg,
      fatPct
    };
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function metricSeries(metric) {
    return chartMeasurements
      .map((measurement) => {
        const value =
          metric === "weight"
            ? measurement.weightKg
            : metric === "fatMass"
              ? measurement.composition?.fatMassKg
              : measurement.composition?.fatPct;

        if (!Number.isFinite(value)) {
          return null;
        }

        return {
          id: measurement.id,
          measuredAt: measurement.measuredAt,
          value,
          display:
            metric === "fatPct"
              ? `${value.toFixed(1)}%`
              : `${value.toFixed(1)} kg`
        };
      })
      .filter(Boolean);
  }

  function selectMeasurement(event) {
    selectedMeasurementId = event.detail.id;
  }

  function formatNumber(value, unit = "") {
    if (!Number.isFinite(value)) {
      return "--";
    }

    return `${value.toFixed(1)}${unit}`;
  }

  function parseNullableNumber(value, fieldName, options = {}) {
    const raw = String(value ?? "").trim();
    if (!raw) {
      return null;
    }

    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      throw new Error(`${fieldName} must be a number`);
    }

    if (options.integer && !Number.isInteger(parsed)) {
      throw new Error(`${fieldName} must be an integer`);
    }

    if (typeof options.min === "number" && parsed < options.min) {
      throw new Error(`${fieldName} must be at least ${options.min}`);
    }

    if (typeof options.max === "number" && parsed > options.max) {
      throw new Error(`${fieldName} must be at most ${options.max}`);
    }

    return parsed;
  }

  async function saveProfile() {
    if (!activeUser) {
      return;
    }

    const trimmedScreenName = profileDraft.screenName.trim();
    if (!trimmedScreenName) {
      profileSaveError = "Screen name is required";
      profileSaveSuccess = "";
      return;
    }

    isSavingProfile = true;
    profileSaveError = "";
    profileSaveSuccess = "";

    let payload;
    try {
      payload = {
        screenName: trimmedScreenName,
        externalUserId: parseNullableNumber(profileDraft.externalUserId, "External User ID", {
          integer: true,
          min: 1
        }),
        profileWeightKg: parseNullableNumber(profileDraft.profileWeightKg, "Weight", {
          min: 0.1
        }),
        profileHeightM: parseNullableNumber(profileDraft.profileHeightM, "Height", {
          min: 0.1
        }),
        profileAgeYears: parseNullableNumber(profileDraft.profileAgeYears, "Age", {
          min: 1
        }),
        profileSex: parseNullableNumber(profileDraft.profileSex, "Sex", {
          integer: true,
          min: 0,
          max: 1
        })
      };
    } catch (error) {
      profileSaveError = error instanceof Error ? error.message : "Invalid profile values";
      isSavingProfile = false;
      return;
    }

    try {
      const response = await fetch(`/api/ui/users/${activeUser.userId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`Failed to save profile (${response.status})`);
      }

      profileSaveSuccess = "Profile saved";
      await loadUsers();
      selectedUserId = activeUser.userId;
    } catch (error) {
      profileSaveError = error instanceof Error ? error.message : "Failed to save profile";
    } finally {
      isSavingProfile = false;
    }
  }

  async function createUserFromDashboard() {
    dashboardCreateError = "";
    const input = globalThis.prompt("Enter new user name");
    const screenName = input?.trim() ?? "";
    if (!screenName) {
      return;
    }

    isCreatingUserFromDashboard = true;
    try {
      const response = await fetch("/api/ui/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ screenName })
      });

      if (!response.ok) {
        throw new Error(`Failed to create user (${response.status})`);
      }

      const payload = await response.json();
      await loadUsers();
      selectedUserId = payload.userId;
    } catch (error) {
      dashboardCreateError = error instanceof Error ? error.message : "Failed to create user";
    } finally {
      isCreatingUserFromDashboard = false;
    }
  }

  async function unlinkSelectedMeasurement() {
    if (!selectedMeasurement) {
      return;
    }

    unlinkError = "";
    isUnlinkingMeasurement = true;
    try {
      const response = await fetch(`/api/ui/measurements/${selectedMeasurement.id}/unlink`, {
        method: "POST"
      });

      if (!response.ok) {
        throw new Error(`Failed to unlink measurement (${response.status})`);
      }

      await loadMeasurements(selectedUserId, rangeWindow);
      await loadUsers();
      await loadUnlinkedCount();
    } catch (error) {
      unlinkError = error instanceof Error ? error.message : "Failed to unlink measurement";
    } finally {
      isUnlinkingMeasurement = false;
    }
  }
</script>

<svelte:head>
  <title>Withings Trends</title>
</svelte:head>

{#if page === "unlinked"}
  <Unlinked
    {users}
    on:back={async () => {
      page = "home";
      await loadUnlinkedCount();
    }}
    on:assigned={async (e) => {
      unlinkedCount = e.detail.remaining;
    }}
    on:usercreated={async (e) => {
      await loadUsers();
      selectedUserId = e.detail.userId;
    }}
  />
{:else if page === "profile"}
  <main class="shell">
    <section class="toolbar">
      <div class="nav-row">
        <button class="nav-button" on:click={() => (page = "home")}>Back to Dashboard</button>
      </div>
    </section>

    {#if activeUser}
      <section class="summary-grid">
        <article>
          <span>Profile</span>
          <strong>{activeUser.screenName}</strong>
          <small>{formatNumber(activeProfile.heightM * 100, " cm")} • {activeProfile.sex === 1 ? "Female" : "Male"} • {activeProfile.ageYears} y</small>
        </article>
        <article>
          <span>Latest Weight</span>
          <strong>{formatNumber(selectedMeasurement?.weightKg, " kg")}</strong>
          <small>{selectedMeasurement ? detailFormatter.format(new Date(selectedMeasurement.measuredAt * 1000)) : "No measurement selected"}</small>
        </article>
      </section>

      <section class="profile-editor">
        <div class="profile-editor-header">
          <p>Edit User Profile</p>
        </div>

        <form class="profile-form" on:submit|preventDefault={saveProfile}>
          <label>
            <span>Screen Name</span>
            <input type="text" bind:value={profileDraft.screenName} maxlength="64" required />
          </label>

          <label>
            <span>External User ID</span>
            <input type="number" min="1" step="1" bind:value={profileDraft.externalUserId} />
          </label>

          <label>
            <span>Weight (kg)</span>
            <input type="number" min="0.1" step="0.1" bind:value={profileDraft.profileWeightKg} />
          </label>

          <label>
            <span>Height (m)</span>
            <input type="number" min="0.1" step="0.01" bind:value={profileDraft.profileHeightM} />
          </label>

          <label>
            <span>Age (years)</span>
            <input type="number" min="1" step="1" bind:value={profileDraft.profileAgeYears} />
          </label>

          <label>
            <span>Sex</span>
            <select bind:value={profileDraft.profileSex}>
              <option value="">Unset</option>
              <option value="0">Male</option>
              <option value="1">Female</option>
            </select>
          </label>

          <div class="profile-form-actions">
            <button class="nav-button" type="submit" disabled={isSavingProfile}>
              {isSavingProfile ? "Saving..." : "Save profile"}
            </button>
            {#if profileSaveError}
              <small class="error">{profileSaveError}</small>
            {:else if profileSaveSuccess}
              <small class="success-note">{profileSaveSuccess}</small>
            {/if}
          </div>
        </form>
      </section>
    {:else}
      <section class="status-card">Select or create a user to edit profile details.</section>
    {/if}
  </main>
{:else}
<section class="user-section">
  <div class="user-section-inner">
    <div class="user-strip" aria-label="Users">
      {#if isLoadingUsers}
        <span class="status-pill">Loading users...</span>
      {:else if usersError}
        <span class="status-pill error">{usersError}</span>
      {:else}
        {#each users as user}
          <button
            class:selected={user.userId === selectedUserId}
            class="user-pill"
            on:click={() => { selectedUserId = user.userId; }}
            title={user.screenName}
          >
            <UserAvatar screenName={user.screenName} size={44} selected={user.userId === selectedUserId} />
            <div class="user-pill-text">
              <span>{user.screenName}</span>
              <small>{user.measurementCount} entries</small>
            </div>
          </button>
        {/each}
        <button
          class="user-add-pill"
          on:click={createUserFromDashboard}
          disabled={isCreatingUserFromDashboard}
          aria-label="Create user"
          title="Create user"
        >
          {#if isCreatingUserFromDashboard}
            ...
          {:else}
            +
          {/if}
        </button>
      {/if}
    </div>
    {#if dashboardCreateError}
      <small class="error">{dashboardCreateError}</small>
    {/if}
  </div>
</section>
<main class="shell">

  {#if unlinkedCount > 0}
    <section class="unlinked-card">
      <button class="unlinked-card-button" on:click={() => (page = "unlinked")}>
        <strong>{unlinkedCount}</strong> unlinked {unlinkedCount === 1 ? "measurement" : "measurements"} →
      </button>
    </section>
  {/if}

  
  {#if showFirstMeasurementOnboarding}
    <section class="status-card onboarding">
      <strong>No measurements yet</strong>
      <p>Stand on the scale to capture the first measurement.</p>
      <p>Refresh this page after taking the measurement.</p>
    </section>
  {:else if showNoUsersOnboarding}
    <section class="status-card onboarding">
      <strong>Create your first user profile</strong>
      <p>Click the add button in the top bar.</p>
    </section>
  {:else if showFirstAssignmentOnboarding}
    <section class="status-card onboarding">
      <strong>Your first measurement has arrived.</strong>
      <button class="nav-button onboarding-action" on:click={() => (page = "unlinked")}>Assign measurement to profile</button>
    </section>
  {/if}

  {#if activeUser}
    <section class="summary-grid">
      <article class="summary-profile-card">
        <div class="summary-card-top">
          <span>Profile</span>
          <button
            class="icon-button"
            on:click={() => (page = "profile")}
            aria-label="Edit profile"
            title="Edit profile"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 17.25V20h2.75L17.81 8.94l-2.75-2.75L4 17.25zm14.71-9.04a1.003 1.003 0 0 0 0-1.42l-1.5-1.5a1.003 1.003 0 0 0-1.42 0l-1.17 1.17 2.75 2.75 1.34-1z"></path>
            </svg>
          </button>
        </div>
        <strong>{activeUser.screenName}</strong>
        <small>{formatNumber(activeProfile.heightM * 100, " cm")} • {activeProfile.sex === 1 ? "Female" : "Male"} • {activeProfile.ageYears} y</small>
      </article>
      <article class="measurement-card">
        <div class="measurement-card-header">
          <span>Latest Measurement</span>
          <small>{selectedMeasurement ? detailFormatter.format(new Date(selectedMeasurement.measuredAt * 1000)) : "No measurement selected"}</small>
        </div>
        <div class="measurement-metrics">
          <div class="metric-item">
            <span>Weight</span>
            <strong>{formatNumber(selectedMeasurement?.weightKg, " kg")}</strong>
          </div>
          <div class="metric-item">
            <span>Fat %</span>
            <strong>{formatNumber(selectedMeasurement?.composition?.fatPct, "%")}</strong>
          </div>
          <div class="metric-item">
            <span>Battery</span>
            <strong>{selectedMeasurement?.batteryLevel ?? "--"}%</strong>
          </div>
        </div>
      </article>
    </section>
  {/if}

  <section class="toolbar">
    <div class="segmented" role="tablist" aria-label="Range">
      {#each Object.entries(RANGE_LABELS) as [value, label]}
        <button class:active={value === rangeMode} on:click={() => (rangeMode = value)}>{label}</button>
      {/each}
    </div>

    <div class="nav-row">
      <button class="nav-button" on:click={() => shiftWindow(-1)} aria-label="Previous period">Back</button>
      <strong>{rangeWindow.label}</strong>
      <button class="nav-button" on:click={() => shiftWindow(1)} aria-label="Next period">Next</button>
    </div>
  </section>

  {#if isLoadingMeasurements}
    <section class="status-card">Loading measurements...</section>
  {:else if measurementsError}
    <section class="status-card error">{measurementsError}</section>
  {:else}
    <section class="chart-stack">
      <MetricChart
        title="Weight"
        unit="kg"
        color="#1f7a8c"
        points={metricSeries("weight")}
        selectedId={selectedMeasurement?.id}
        on:select={selectMeasurement}
      />
      <MetricChart
        title="Fat Mass"
        unit="kg"
        color="#d97757"
        points={metricSeries("fatMass")}
        selectedId={selectedMeasurement?.id}
        on:select={selectMeasurement}
      />
      <MetricChart
        title="Body Fat"
        unit="%"
        color="#5b8c5a"
        points={metricSeries("fatPct")}
        selectedId={selectedMeasurement?.id}
        on:select={selectMeasurement}
      />
    </section>

    <section class="detail-card">
      <div class="detail-header">
        <div>
          <p>Measurement Detail</p>
          <h2>
            {#if selectedMeasurement}
              {detailFormatter.format(new Date(selectedMeasurement.measuredAt * 1000))}
            {:else}
              Select a point
            {/if}
          </h2>
        </div>
        {#if selectedMeasurement}
          <button class="unlink-btn" disabled={isUnlinkingMeasurement} on:click={unlinkSelectedMeasurement}>
            {isUnlinkingMeasurement ? "Unlinking..." : "Unlink"}
          </button>
        {/if}
      </div>
      {#if unlinkError}
        <small class="error">{unlinkError}</small>
      {/if}

      {#if selectedMeasurement}
        <div class="detail-grid">
          <article>
            <span>Weight</span>
            <strong>{formatNumber(selectedMeasurement.weightKg, " kg")}</strong>
          </article>
          <article>
            <span>Fat Mass</span>
            <strong>{formatNumber(selectedMeasurement.composition?.fatMassKg, " kg")}</strong>
          </article>
          <article>
            <span>Body Fat</span>
            <strong>{formatNumber(selectedMeasurement.composition?.fatPct, "%")}</strong>
          </article>
          <article>
            <span>RE</span>
            <strong>{formatNumber(selectedMeasurement.reValue)}</strong>
          </article>
        </div>

        <div class="meta-grid">
          <div>
            <span>Total Body Water</span>
            <strong>{formatNumber(selectedMeasurement.composition?.tbw, " L")}</strong>
          </div>
          <div>
            <span>Battery</span>
            <strong>{selectedMeasurement.batteryLevel ?? "--"}%</strong>
          </div>
        </div>

        <div class="values-block">
          <p>Measurement values</p>
          <div class="value-list">
            {#each selectedMeasurement.values as value}
              <div>
                <span>{value.label}</span>
                <strong>{formatNumber(value.normalizedValue)}</strong>
              </div>
            {/each}
          </div>
        </div>
      {:else}
        <div class="empty-detail">No measurement in this range yet.</div>
      {/if}
    </section>
  {/if}
</main>
{/if}