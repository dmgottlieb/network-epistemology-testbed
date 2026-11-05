# Network Epistemology Testbed

Browser-based implementations of models from network epistemology: how the
communication structure of a scientific community affects what it learns.
Everything is plain HTML and JavaScript with no build step. Open `index.html`
directly from disk, or serve the folder with any static server
(`python3 -m http.server`).

## Models

### 1. The Zollman effect (`zollman.html`)

The Bala–Goyal two-armed bandit on a network, in the form used by Zollman (2007)
and Rosenstock, Bruner & O’Connor (2017):

- Action A succeeds with known probability 0.5. Action B succeeds with
  probability 0.5 + ε, but agents only know that it is either 0.5 + ε or 0.5 − ε.
- Each agent has a credence that B is better. Agents with credence > 0.5 try B
  `n` times per round; the others do A, which yields no information.
- Agents update by Bayes’ rule on their own results and their neighbours’.
- A run ends with a right consensus (everyone > 0.99), a wrong consensus
  (everyone ≤ 0.5, so nobody tests B again), or at a round cap.

The page has:

- **Twin runs.** Two networks side by side on *coupled* evidence: the same
  seed gives every agent the same prior and the same experimental results in
  both panels, so any difference in outcome comes from the network alone.
  Network diagram with results animating along links, per-agent belief
  trajectories (credence or log-odds scale), hover to follow one agent in both
  networks, and a search for seeds where the two networks disagree.
- **Network families.** Complete, cycle, wheel, star, line, ring lattice, grid,
  clusters joined by bridges, Erdős–Rényi, Watts–Strogatz small world,
  Barabási–Albert scale-free.
- **Monte Carlo experiment.** Sweep N, ε or n across several networks, with
  95% Wilson intervals, mean rounds to a right consensus, and a results table
  including the Zollman effect (cycle − complete). Four presets reproduce the
  robustness analyses of Rosenstock, Bruner & O’Connor (2017); their results are
  precomputed in `data/zollman-presets.js` and can be recomputed in the browser.

### 2. Scientific polarization (`polarization.html`)

O'Connor & Weatherall (2018). The bandit above, except that agents treat other
people's results as uncertain evidence and update by Jeffrey's rule, trusting a
source less the further its credence is from their own (mistrust multiplier
`m`). Evidence from someone too distrusted is either ignored (their Eq. 2) or
held against them (Eq. 1). A new absorbing state appears: stable polarization,
where the believers are above 0.99 and every doubter is out of their reach.

- Two panels on coupled evidence, each with its own `m`; links fade, go
  dotted or turn red as trust breaks, and results stall partway along
  distrusted links. The belief chart shades the region beyond the reach of a
  consensus.
- With `m = 0` the engine reproduces Model 1 exactly, run for run.
- Presets reproduce the paper's Figs. 2–4 (e.g. 64% polarized at m = 1.5 and
  92% at m = 2 for 10 agents, n = 50, pB = .7, vs. about 64% and 91% in the
  paper), plus two checks the paper does not include.
- **Update order matters.** Jeffrey updates do not commute and the paper does
  not say what order agents update in. Updating one agent at a time, judging
  distance from credences as they stand (as in Weisberg's reimplementation),
  reproduces the paper. Having every agent judge distance from start-of-round
  credences polarizes far less at moderate `m` (about 11% instead of 64% at
  m = 1.5). Both are available.

### Analysis: what is a cycle worth? (`exchange.html`)

Built on Model 1 with an exploration rule added in the spirit of Kummerfeld &
Zollman (2016): each round, every doubter tests B anyway with probability `x`.
That removes the absorbing wrong consensus. The page measures how much
exploration a complete network needs to be as reliable as a given sparse
network with none.

- **Budget is the currency.** With `x = budget / horizon`, the complete
  network's reliability depends on the budget alone, not the horizon (e.g.
  budget 10: 95.8%, 96.4%, 96.4% at horizons of 2,000, 10,000, 50,000 rounds).
- **Exchange rates** (10 agents, ε = 0.001, n = 1,000; 20,000 runs each): cycle
  ≈ 14 exploratory tests per agent, line ≈ 13.5, grid / star / random tree
  ≈ 11–12, wheel / ring lattice (k = 2) / small world ≈ 7–8, ring lattice
  (k = 3) ≈ 3. Mostly determined by the number of links.
- **Prevention vs. cure.** With any budget the complete network still falls
  into the trap in about 10% of runs and then climbs out; the cycle falls in
  only 2.7% of the time and never escapes. The page marks agents who test B
  against the community's pooled evidence: deliberate explorers in the complete
  network, uninformed agents in the cycle.

## Layout

```
index.html                  landing page
zollman.html                model 1 page          app/zollman-app.js
polarization.html           model 2 page          app/polarization-app.js
exchange.html               exploration analysis  app/exchange-app.js
css/lab.css                 shared page styles
models/zollman.js           model 1 engine, with optional exploration (no DOM; runs in Node)
models/polarization.js      model 2 engine
models/polarization-sweep.js  parameter sweeps shared by page and precompute script
lib/rng.js                  seeded PRNG, binomial sampler
lib/networks.js             graph generators and layouts
lib/views.js                canvas network / trajectory / strip views
lib/charts.js               SVG line charts
data/*.js                   precomputed results, generated by tools/precompute-*.js
tests/                      node --test tests/*.test.js
```

New models should follow the same split: a DOM-free engine in `models/` that
can be tested in Node, and a page plus UI script.

## Checks

```
node --test tests/*.test.js
```

The tests check the Bayes and Jeffrey updates, network construction, the
sampler, the polarization classifier and the exploration option. They also
reproduce O'Connor & Weatherall's Fig. 2 polarization rates and the published
Zollman headline result: at N = 10, ε = 0.001, n = 1,000 the
complete network reaches the right consensus about 89% of the time and the
cycle about 97%. The precomputed presets also match Rosenstock et al.’s reported
N = 100 figures (complete 99.1% in about 20 rounds; cycle 100% in about 1,980).

Batches of n ≥ 60 trials (when the standard deviation is at least 3) use a
normal approximation to the binomial; smaller batches are drawn exactly.

## References

- Bala, V. & Goyal, S. (1998). Learning from neighbours. *Review of Economic Studies* 65(3).
- Zollman, K. J. S. (2007). The communication structure of epistemic communities. *Philosophy of Science* 74(5).
- Zollman, K. J. S. (2010). The epistemic benefit of transient diversity. *Erkenntnis* 72.
- Rosenstock, S., Bruner, J. & O’Connor, C. (2017). In epistemic networks, is less really more? *Philosophy of Science* 84(2).
- O’Connor, C. & Weatherall, J. O. (2018). Scientific polarization. *European Journal for Philosophy of Science* 8. <https://arxiv.org/abs/1712.04561>
- Kummerfeld, E. & Zollman, K. J. S. (2016). Conservatism and the scientific state of nature. *British Journal for the Philosophy of Science* 67(4).
- Weisberg, J. (2020). Blog series on the Zollman effect and polarization: <https://jonathanweisberg.org/post/zollman/>, code at <https://github.com/jweisber/sep-sen>
