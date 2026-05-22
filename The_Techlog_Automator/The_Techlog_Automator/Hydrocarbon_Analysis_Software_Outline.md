# Autonomous Hydrocarbon Analysis Software: Functional Requirements

# I have left you in this folder some logs so you can decide which properties work best for this project (I gave you instructions below but you can adjust to them if there are properties you think should be included)

## 1. Core Autonomous Detection Engine

The software processes LAS files using a physics-based ruleset to identify pay zones without manual intervention:

- **Lithology & Shale Filtering**: Automatically identifies "clean" reservoir rocks using Gamma Ray and Photoelectric logs.
- **Shale Volume ($V_{sh}$) Calculation**: Automatically flags and measures shale content in non-reservoir zones.
- **Porosity & Saturation Analysis**: Calculates total and effective porosity, along with irreducible water saturation ($S_{wirr}$), to determine fluid storage capacity.
- **Multi-Log Verification**: Cross-references high Resistivity with Neutron-Density crossover to confirm hydrocarbon presence and eliminate false positives.
- **Fluid Classification**: Autonomously distinguishes between oil and gas signatures based on crossover intensity.

## 2. Software Interface & Tab Structure (whatever interface you think is better)

### Tab 1: Batch Loading & Configuration

- **Multi-Well Support**: Upload and process multiple LAS files simultaneously.
- **Targeting Parameters**: Set specific goals, such as searching for gas/oil, shale reservoirs, or specific permeability and water saturation ranges.
- **Constraint Inputs**: Configure thresholds for automated detection (e.g., minimum porosity or maximum $V_{sh}$).

### Tab 2: Automated Pay Zone Summary & Identification

- **Depth Detection List**: A list of all depths where the engine autonomously detects hydrocarbons.
- **Graphical Tracking**: Automatic marking and shading of the detected pay zones directly on the log tracks.
- **Reservoir Metrics**: Automated display of $V_{sh}$, irreducible water saturation, and the percentage of producible hydrocarbons.
- **Geological Context**: Automatic identification of caprock type and associated hold-up pressures.

### Tab 3: Evidence & Crossover Validation

- **Verification Interface**: A dedicated tab showing physical evidence (Neutron-Density crossover) to back up the automated detection.
- **Interactive Depths**: Select or click a range of detected depths to instantly update the corresponding crossover plots.

### Tab 4: Production Property Analytics

- **Comparative Distribution**: Bar charts illustrating how production properties (porosity, saturation, etc.) vary across each detected zone.
- **Visual Flexibility**: View multiple property plots in sub-tabs or combine them into a single aggregate visualization.
