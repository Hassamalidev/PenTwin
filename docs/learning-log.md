# Learning log

One section for each `pnpm learn --write` run. "Distance" is how far generated pages sit from
the real range: 0 is inside it on every measure. See `docs/learning-loop.md`.

## Run: 10 real pages, 8 writers, 40 steps

| Style   | Distance before | After |
| ------- | --------------- | ----- |
| neat    | 1.376           | 0.466 |
| normal  | 1.354           | 0.379 |
| rushed  | 1.469           | 0.617 |
| exam    | 1.409           | 0.426 |
| lecture | 1.120           | 0.385 |

## Run: 10 real pages, 8 writers, 40 steps

| Style   | Distance before | After |
| ------- | --------------- | ----- |
| neat    | 1.057           | 0.347 |
| normal  | 0.966           | 0.336 |
| rushed  | 1.477           | 0.681 |
| exam    | 1.047           | 0.292 |
| lecture | 1.022           | 0.396 |

## Real pages against generated pages, after training

Measured by the same code (`pnpm real:measure`). "out" marks a value outside the range the
middle 80% of real pages fall in. Before training, Normal was outside on 11 of 13 measures;
after it, on 7. Size variation and marks per word are shown but not trained on, because for
joined writing they describe joining, not letter size. After the last training run the
styles were sorted into a fixed order (neat, normal, lecture, exam, rushed), which is why
some values moved further from the middle of the range.

| Measure              | Real low | Real middle | Real high | neat      | normal    | rushed     | exam       | lecture    |
| -------------------- | -------- | ----------- | --------- | --------- | --------- | ---------- | ---------- | ---------- |
| lineSpacing          | 2.689    | 3.396       | 4.246     | 2.601 out | 2.762     | 2.828      | 2.651 out  | 2.694      |
| lineSpacingVariation | 0.086    | 0.146       | 0.297     | 0.088     | 0.057 out | 0.150      | 0.270      | 0.062 out  |
| lineSlopeSpread      | 0.650    | 1.373       | 1.796     | 0.568 out | 0.730     | 1.697      | 1.924 out  | 1.227      |
| baselineSpread       | 0.173    | 0.219       | 0.260     | 0.095 out | 0.151 out | 0.191      | 0.228      | 0.191      |
| wordGap              | 1.091    | 1.667       | 1.966     | 1.212     | 1.844     | 2.094 out  | 2.188 out  | 2.000 out  |
| wordGapVariation     | 0.280    | 0.928       | 1.151     | 0.090 out | 0.190 out | 0.271 out  | 0.564      | 0.419      |
| sizeVariation        | 0.200    | 0.216       | 0.239     | 0.092 out | 0.110 out | 0.143 out  | 0.132 out  | 0.135 out  |
| marksPerWord         | 3.107    | 3.549       | 4.552     | 4.299     | 4.265     | 3.892      | 4.000      | 4.046      |
| slant                | -8.000   | 0.000       | 12.000    | 2.000     | 6.000     | 18.000 out | 14.000 out | 14.000 out |
| slantSpread          | 3.000    | 5.033       | 6.619     | 1.414 out | 2.261 out | 4.088      | 4.553      | 3.127      |
| leftSpread           | 0.467    | 0.823       | 3.217     | 0.127 out | 0.253 out | 0.158 out  | 6.051 out  | 0.181 out  |
| rightSpread          | 1.883    | 2.957       | 5.067     | 2.186     | 5.964 out | 3.266      | 6.263 out  | 2.068      |
| strokeWidth          | 0.073    | 0.086       | 0.106     | 0.123 out | 0.096     | 0.094      | 0.089      | 0.093      |
