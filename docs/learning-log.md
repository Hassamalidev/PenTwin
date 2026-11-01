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

## Run: 51 real pages, 26 writers, 40 steps

| Style   | Distance before | After |
| ------- | --------------- | ----- |
| neat    | 0.336           | 0.032 |
| normal  | 0.419           | 0.148 |
| rushed  | 0.913           | 0.534 |
| exam    | 0.599           | 0.271 |
| lecture | 0.511           | 0.226 |

## Real pages against generated pages, on 51 pages from 26 writers

Normal is inside the real range on 11 of 13 measures. The range is also wider than with
ten pages, because more writers vary more, so part of this gain comes from a wider target.

| Measure              | Real low | Real middle | Real high | neat      | normal    | rushed    | exam      | lecture   |
| -------------------- | -------- | ----------- | --------- | --------- | --------- | --------- | --------- | --------- |
| lineSpacing          | 2.412    | 3.094       | 4.661     | 2.771     | 2.802     | 2.860     | 2.759     | 2.712     |
| lineSpacingVariation | 0.053    | 0.102       | 0.457     | 0.052 out | 0.068     | 0.138     | 0.272     | 0.126     |
| lineSlopeSpread      | 0.338    | 0.784       | 1.460     | 0.765     | 1.246     | 1.620 out | 3.938 out | 2.069 out |
| baselineSpread       | 0.116    | 0.179       | 0.262     | 0.084 out | 0.129     | 0.209     | 0.198     | 0.168     |
| wordGap              | 0.762    | 1.545       | 3.182     | 0.818     | 1.406     | 1.531     | 1.563     | 1.515     |
| wordGapVariation     | 0.233    | 0.783       | 1.638     | 0.161 out | 0.197 out | 0.244     | 1.531     | 0.455     |
| sizeVariation        | 0.148    | 0.205       | 0.251     | 0.094 out | 0.110 out | 0.143 out | 0.131 out | 0.142     |
| marksPerWord         | 2.188    | 3.500       | 5.000     | 4.239     | 4.235     | 4.048     | 4.297     | 4.222     |
| slant                | -10.000  | 0.000       | 32.000    | 2.000     | 6.000     | 18.000    | 10.000    | 12.000    |
| slantSpread          | 1.574    | 3.693       | 7.559     | 1.799     | 2.816     | 4.256     | 4.238     | 3.621     |
| leftSpread           | 0.284    | 1.097       | 5.608     | 0.095 out | 0.300     | 0.274 out | 0.578     | 0.261 out |
| rightSpread          | 1.552    | 2.497       | 6.922     | 1.555     | 2.733     | 1.453 out | 3.415     | 1.801     |
| strokeWidth          | 0.052    | 0.081       | 0.142     | 0.117     | 0.096     | 0.094     | 0.096     | 0.094     |
