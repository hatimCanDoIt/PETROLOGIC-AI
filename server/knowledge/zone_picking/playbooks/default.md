# Zone picking — expert heuristics (pass 1)

## Rw and water saturation

Formation water resistivity **Rw** is the baseline for Archie Sw. It should come
from the log: in clean, porous, water-bearing rock, apparent water resistivity
**Rwa** approaches Rw; in hydrocarbon zones Rwa is higher. The engine can take
a low percentile of Rwa (not a single noisy minimum) over qualifying samples —
the expert should **not** need to type Rw for routine work unless overriding a
bad auto estimate.

If Sw looks systematically wrong, review **a, m, n** and whether the **deep RT**
curve truly represents virgin formation resistivity.

## Depth context

For current deep-target work, meaningful pay is typically **10,000 ft MD and
deeper**. Intervals far above that in a deep well may be water, shale, or
non-reservoir — do not assume pay without full log context.

## Cap rock (seal) — required

A reservoir must **hold** hydrocarbons. Before calling pay, look **above** the
candidate top for cap rock: shaly / tight / low-porosity section (often high GR,
low NPHI/DPHI, high Vsh). Open porous sand with no seal above is a **migration
risk**, not a completed trap — downgrade or reject the zone and say why in the
rationale.

## Neutron–density first, resistivity second

**NPHI and DPHI** are primary evidence for hydrocarbons (especially gas:
density–neutron crossover or **near**-crossover). Do not rely on deep RT alone.

Typical pay support stack:

1. Clean-ish sand: **low GR / low Vsh**
2. **phi_eff** above cutoff
3. **NPHI–DPHI** crossover or close approach (gas); oil may lack strong crossover
4. **SP** deflection consistent with permeable sandstone
5. **RT** — deep resistivity above wet trend; see invasion note below

### Near-crossover counts

If DPHI and NPHI are **close** or barely crossed (weaker than the strict 0.03
gas threshold), still consider HC when GR, SP, and porosity support a reservoir
sand — especially if Archie Sw is ambiguous because RT is only moderate.

## Multiple resistivity curves (invasion)

Use **deep, medium, and shallow** resistivity together when available:

- **Deep** (90" / ILD / LLD): virgin formation, best for Archie — can read **low**
  under invasion even when HC is present.
- **Medium / shallow**: often higher in invaded gas/oil sands.

If deep RT is only slightly above the wet baseline but **shallow–medium RT**
separates or **NPHI/DPHI** show HC, favor pay with **medium** confidence and
explain invasion in the rationale.

## Reference interval (confirm well + units)

**2917–2952** (confirm ft vs m and well name): deep RT may look **below** the
well’s average RT, yet **NPHI–DPHI** are close/crossed, **phi_eff** high, **SP**
sand line, **Vsh** low — treat as **candidate pay**, not automatic rejection.

When this well is labeled, add a few-shot example under `examples/`.
