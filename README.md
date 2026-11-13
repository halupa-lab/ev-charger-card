# EV Charger Card

Home Assistant card for an ElectroS WiFi EV charger with a Deye hybrid inverter: charger state, where the car power comes from now (solar / home battery / grid), start / stop, charging current, "charge only at night", "hold home battery", and how much the car took (kWh by source, grid cost in UAH, km estimate) per session, day, month or year.

One JavaScript file, no build step, no dependencies.

> Work in progress: the card is being rebuilt step by step from a proof of concept.

## Requirements

- The ElectroS integration fork [electros-ev-local-ha](https://github.com/halupa-lab/electros-ev-local-ha) v1.8.0+ (fixed entity IDs `switch.electros_charging`, `sensor.electros_status`, …).
- The packages [ev-charger-packages](https://github.com/halupa-lab/ev-charger-packages): car power by source, kWh and UAH counters, "hold home battery", "charge only at night".

## Install (HACS)

1. HACS → ⋮ → Custom repositories → paste this repository URL, category **Dashboard** → Add.
2. Open **EV Charger Card** in HACS → Download.
3. Reload the browser page.

HACS adds the dashboard resource automatically. Updates come as new releases in HACS.

## Add to a dashboard

```yaml
type: custom:ev-charger-card
consumption: 20          # kWh per 100 km, as the car shows it
charge_efficiency: 0.9   # share of the wall energy that reaches the car battery
```

| Key | Default | Meaning |
|---|---|---|
| `view` | `all` | `all`, `charge` (state and controls) or `money` (kWh and UAH) |
| `title` | `Зарядка авто` | Card title; `''` hides it |
| `consumption` | `20` | kWh per 100 km, for the km estimate |
| `charge_efficiency` | `0.9` | Wall → car battery |
| `max_current` | `22` | Current ceiling of the charger line, A |
| `status`, `switch`, `current`, `measured_current`, `set_current`, `voltage` | `sensor.electros_status`, `switch.electros_charging`, `number.electros_charging_current`, `sensor.electros_measured_current`, `sensor.electros_set_current`, `sensor.electros_voltage` | Charger entities |
| `power`, `solar_power`, `battery_power`, `grid_power` | `sensor.ev_charger_power`, `sensor.ev_charger_solar_power`, … | Car power by source (packages) |
| `hold`, `hold_timer`, `night`, `battery_soc` | `input_boolean.ev_battery_hold`, `timer.ev_battery_hold_limit`, `input_boolean.ev_night_mode`, `sensor.deye_inverter_battery` | Packages and Deye |
| `timer`, `clock_offset` | `sensor.electros_timer`, `sensor.electros_clock_offset` | The timer stored in the charger and its clock offset (integration fork) |
| `charge_now`, `charge_now_flag` | `script.ev_charge_now`, `input_boolean.ev_charge_now` | "Зарядити зараз" (packages v0.4.0+) |
| `clock_warn` | `60` | Show the charger clock offset above this many seconds |

## Two cards instead of one

`view: charge` (state and controls) and `view: money` (kWh and UAH) as two cards, e.g. in two sections of a sections dashboard: side by side on a computer, one under the other on a phone.

```yaml
type: sections
max_columns: 2
sections:
  - type: grid
    cards:
      - type: custom:ev-charger-card
        view: charge
  - type: grid
    cards:
      - type: custom:ev-charger-card
        view: money
        consumption: 20
        charge_efficiency: 0.9
```

## License

MIT
