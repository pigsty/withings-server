<script>
  import { createEventDispatcher } from "svelte";

  export let title = "";
  export let unit = "";
  export let color = "#1f7a8c";
  export let points = [];
  export let selectedId = undefined;

  const dispatch = createEventDispatcher();
  const width = 320;
  const height = 124;
  const padX = 14;
  const padTop = 12;
  const padBottom = 18;

  $: values = points.map((point) => point.value).filter((value) => Number.isFinite(value));
  $: minValue = values.length ? Math.min(...values) : 0;
  $: maxValue = values.length ? Math.max(...values) : 1;
  $: meanValue = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  $: spread = Math.max(maxValue - minValue, 0.1);
  $: selectedPoint = points.find((p) => p.id === selectedId) ?? points[points.length - 1];

  function xFor(index) {
    if (points.length <= 1) {
      return width / 2;
    }

    return padX + (index / (points.length - 1)) * (width - padX * 2);
  }

  function yFor(value) {
    const normalized = (value - minValue) / spread;
    return padTop + (1 - normalized) * (height - padTop - padBottom);
  }

  $: linePath = points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${xFor(index)} ${yFor(point.value)}`)
    .join(" ");

  $: areaPath = points.length
    ? `${linePath} L ${xFor(points.length - 1)} ${height - padBottom} L ${xFor(0)} ${height - padBottom} Z`
    : "";

  function selectPoint(point) {
    dispatch("select", point);
  }
</script>

<section class="metric-card">
  <div class="metric-header">
    <div>
      <p>{title}</p>
      {#if points.length}
        {#key selectedPoint?.id}
          <strong class="animated-value">{selectedPoint?.display ?? points[points.length - 1].display}</strong>
        {/key}
      {/if}
    </div>
    {#if values.length}
      <small class="metric-stats">
        <span>min {minValue.toFixed(1)}{unit}</span>
        <span>avg {meanValue.toFixed(1)}{unit}</span>
        <span>max {maxValue.toFixed(1)}{unit}</span>
      </small>
    {/if}
  </div>

  {#if points.length}
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
      <defs>
        <linearGradient id={`fill-${title}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color={color} stop-opacity="0.28" />
          <stop offset="100%" stop-color={color} stop-opacity="0.02" />
        </linearGradient>
      </defs>
      <line class="baseline" x1={padX} y1={height - padBottom} x2={width - padX} y2={height - padBottom}></line>
      <path d={areaPath} fill={`url(#fill-${title})`}></path>
      <path d={linePath} stroke={color} stroke-width="3" fill="none" stroke-linecap="round"></path>
      {#each points as point, index}
        <g
          role="button"
          tabindex="0"
          aria-label="{title} measurement on {point.label ?? index}"
          on:click={() => selectPoint(point)}
          on:keydown={(e) => (e.key === 'Enter' || e.key === ' ') && selectPoint(point)}
        >
          <circle
            class="chart-point"
            class:point-selected={point.id === selectedId}
            cx={xFor(index)}
            cy={yFor(point.value)}
            r={point.id === selectedId ? 6 : 4}
            fill={point.id === selectedId ? color : "var(--panel-strong)"}
            stroke={color}
            stroke-width="2"
          ></circle>
        </g>
      {/each}
    </svg>
  {:else}
    <div class="empty-chart">No measurements in this period.</div>
  {/if}
</section>