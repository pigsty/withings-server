<script>
  export let screenName = "?";
  export let selected = false;
  export let size = 44;

  function initials(name) {
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) {
      return (parts[0] ?? "?").slice(0, 2).toUpperCase();
    }
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  $: label = initials(screenName);
</script>

<div
  class="avatar"
  class:selected
  style="width:{size}px;height:{size}px;font-size:{Math.round(size * 0.38)}px;"
  aria-label={screenName}
>
  {label}
</div>

<style>
  .avatar {
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background: linear-gradient(135deg, var(--avatar-bg-start, #1f7a8c) 0%, var(--avatar-bg-end, #2a9baf) 100%);
    color: var(--avatar-fg, #fff);
    font-weight: 700;
    letter-spacing: 0.03em;
    flex-shrink: 0;
    transition: box-shadow 0.15s, transform 0.15s;
    user-select: none;
  }

  .avatar.selected {
    box-shadow: 0 0 0 3px var(--avatar-ring-inner, #fff), 0 0 0 5px var(--avatar-ring-outer, #1f7a8c);
    transform: scale(1.06);
  }
</style>
