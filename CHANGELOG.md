# Changelog

## v0.1.0

- The POC card (`reference/www/ev-charger-card.js` 0.3.0) moved to this repository and installed through HACS. Same behaviour as the POC.
- Element `custom:ev-charger-card`, the same as the POC card it replaces (remove the POC file `/local/ev-charger-card.js` and its dashboard resource first).
- The date switcher under "Скільки взяла машина" is two rows: the range on its own line, so the session end time fits on a phone.
- Default entity IDs are the fixed English IDs of the ElectroS integration fork v1.8.0 (`switch.electros_charging`, `sensor.electros_status`, …); no entity keys needed in the card YAML.
