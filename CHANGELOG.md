# Changelog

## v0.3.2

- Session times are rounded to the nearest minute, not cut: the charger clock runs a few seconds fast, so its 07:00 timer stop (06:59:54 by HA time) showed as "06:59".

## v0.3.1

- Session start and end are the real times from the charger switch history, not the 5-minute statistics grid: a timer stop at 06:59:55 showed as "07:05". The kWh and UAH still come from the statistics over the 5-minute range. Without the history (older than 10 days, or the request fails) the card shows the grid times as before.
- Current hint: the card current "застосується, щойно почнеться зарядка" (packages send it when charging starts), not "коли зарядку запустить HA".

## v0.3.0

- "Почати зарядку" is the charger's own start, also while the timer waits: a one-off charge now, and the timer stays stored in the charger (it reads as off meanwhile). Before, the button turned "charge only at night" off. Needs packages v0.4.7+, which leave a one-off charge alone and put the timer back once it is over.
- "Заряджати лише вночі" is now "Заряджати за таймером". The state line shows "разова зарядка" or "за таймером до 07:00" while charging and "Чекає таймера" before the timer start; hints explain that a stop inside the timer window lasts only a moment (the charger resumes by the timer).
- No "Зарядити зараз": removed the `charge_now` and `charge_now_flag` options (`script.ev_charge_now` goes away in packages v0.4.8).

## v0.2.1

- Fix: pressing "+" and then "−" (back to the same current) within a moment sent an empty value, and HA showed "expected float at 'value'". Now nothing is sent when the current did not change.

## v0.2.0

Needs ev-charger-packages v0.4.0 (`script.ev_charge_now`).

- The main button follows the charger: "Зупинити зарядку" while charging, "Зарядити зараз" when a car is plugged in but not charging (calls `script.ev_charge_now`: a one-off charge past the night timer), "Підключіть машину" (disabled) without a car, "Запускаю…" while the script runs. The old "Почати зарядку" sent a start that the charger timer ignores.
- New state "Машина не підключена". The "charge only at night" line shows the timer that is really in the charger, a one-off charge, and the charger clock offset when it is over 60 s.
- Switching day / month / year / session keeps the previous numbers (dimmed) until the new ones arrive, and the note line is always reserved: the card no longer jumps.
- Off toggles are visible in the light theme. The offline hint no longer names the Wi-Fi network.

## v0.1.0

- The POC card (`reference/www/ev-charger-card.js` 0.3.0) moved to this repository and installed through HACS. Same behaviour as the POC.
- Element `custom:ev-charger-card`, the same as the POC card it replaces (remove the POC file `/local/ev-charger-card.js` and its dashboard resource first).
- The date switcher under "Скільки взяла машина" is two rows: the range on its own line, so the session end time fits on a phone.
- Default entity IDs are the fixed English IDs of the ElectroS integration fork v1.8.0 (`switch.electros_charging`, `sensor.electros_status`, …); no entity keys needed in the card YAML.
