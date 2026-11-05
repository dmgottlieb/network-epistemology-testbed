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
- **The published version.** Kummerfeld & Zollman's (2016) model
  (`models/kummerfeld-zollman.js`): ε-greedy averaging agents, 50 rounds of one
  pull, a safe arm paying 0 and a risky arm ~ N(1, sd 9). Reproduces their
  Fig. 6 (8 agents: complete 0.41 → peak ≈ 0.65 near ε = 0.17; ring 0.54 → peak
  ≈ 0.61 near ε = 0.13; crossing near ε = 0.07). Two details are reconstructed
  to match that figure: the risky arm's sd is 9 (the text says variance 9),
  and an arm an agent has no results for counts as the better one.

### 3. Transient diversity (`diversity.html`)

Zollman (2010). Both methods' success rates are unknown (0.5 and 0.499);
each agent holds beta priors on both, with parameters uniform on [0, max].
`max` measures dogmatism. Reproduces Fig. 3 (cycle 0.67 → 0.95 as N goes
from 4 to 11; complete 0.50–0.64) and the diversity-over-time curves of Fig. 7.
Fig. 6's reversal under dogmatic priors depends on the horizon: at 10,000
rounds our dogmatic cycles still mostly learn; at 3,000 the reversal appears.

### 4. Conformity (`conformity.html`)

Weatherall & O'Connor (2021). Beta agents add k × (neighbours doing the same −
neighbours doing otherwise) to each arm's expected payoff. Five outcomes:
correct / incorrect consensus, each with or without hidden disagreement, and
polarization. Agents choose one at a time in random order and do not count
themselves; only that combination reproduces the paper's claims that cycles
and complete networks never polarize stably (k = 0.1: cycle 84%, wheel 53%,
complete 51% on the better action vs. 87%, 57%, ~55% in the paper; two
cliques polarize in about half of runs).

### 5. Propaganda (`propaganda.html`)

Weatherall, O'Connor & Bruner (2020). Model 1 scientists plus sceptical policy
makers and a propagandist who forwards only results favouring A (selective
sharing) or funds its own studies and publishes only the favourable ones
(biased production); also journalists who report all, two random, or one
result per side ("fair"). The science is identical with and without the
propagandist for the same seed. Study-size effects (Figs. 4, 7) and the funded
propagandist (Fig. 6) match the paper within ~0.1; with selective sharing our
policy makers resist better than in Fig. 2 when they follow most scientists.

### 6. Free-riding on exploration (`freerider.html`)

Kummerfeld & Zollman's Choose-Your-ε game. One hero's best reply to the
group's exploration rate, estimated with common random numbers; symmetric Nash
equilibria at 0.24, 0.13, 0.08, 0.05 for 2, 4, 6, 8 connected scientists
(paper: 0.24, 0.13, 0.085, 0.06) against community optima near 0.32–0.18.

### 7. Learning whom to trust (`trust.html`)

Barrett, Skyrms & Mohseni's (2019) self-assembling networks with Pozzi's
(2025) vigilance parameter. Each agent has an urn of balls for nature, itself
and every other agent; it draws one each round, observes nature or adopts the
chosen agent's belief, and adds a ball when that worked (credulous agents also
credit wrong sources with probability 1 − V; sceptical agents credit right ones
only with probability V). Over 100 problems of 100 rounds, collective knowledge
matches Pozzi's stable-network results within about 0.02 (e.g. credulous,
V = 0: 0.64 / 0.26 for 5 / 100 agents vs. 0.64 / 0.24). Turnover is applied
once per problem; per round, every community collapses.

### 8. Intransigently biased agents (`biased.html`)

Holman & Bruner (2015). Six Zollman-2010 doctors and a drug company that only
prescribes its own drug and reports Binomial(N, pB + b) results. Static
networks (wheel with the company at the hub, up to complete) count every result
in full; in the dynamic network each doctor weighs sources by ball counts that
grow or shrink with a one-sample t-test of each report (b_ij += L(1.96 − |t|)).
Bias 0.03, N = 5,000: better drug 43% (wheel) / 61% (complete) vs. 42% / 63%
in the paper (which gives no N). Bias 0.08, N = 1,000: static ~0, dynamic ~85%
(paper: almost never / 80%).

## Layout

```
index.html                  landing page
zollman.html                model 1 page          app/zollman-app.js
polarization.html           model 2 page          app/polarization-app.js
exchange.html               exploration analysis  app/exchange-app.js, app/kz-section.js
diversity.html              model 3 page          app/beta-lab.js (shared with conformity)
conformity.html             model 4 page          app/beta-lab.js
propaganda.html             model 5 page          app/propaganda-app.js
freerider.html              model 6 page          app/freerider-app.js
trust.html                  model 7 page          app/trust-app.js
biased.html                 model 8 page          app/biased-app.js
css/lab.css                 shared page styles
models/zollman.js           model 1 engine, with optional exploration (no DOM; runs in Node)
models/polarization.js      model 2 engine
models/polarization-sweep.js  parameter sweeps shared by page and precompute script
models/kummerfeld-zollman.js  Kummerfeld & Zollman (2016) epsilon-greedy model and hero game
models/beta-bandit.js       beta-belief agents (Zollman 2010; conformity)
models/propaganda.js        policy makers, propagandist, journalists
models/trust.js             urn reinforcement learning of whom to consult
models/biased.js            Holman & Bruner doctors, biased company, t-test trust
models/experiments.js       one-run functions for the sweeps on models 3-5 and 7
lib/sweep.js, lib/experiment-ui.js, lib/lab.js   generic sweep, experiment panel, playback
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
reproduce O'Connor & Weatherall's Fig. 2 polarization rates, the endpoints of
Kummerfeld & Zollman's Fig. 6, and the published
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
- Weatherall, J. O., O'Connor, C. & Bruner, J. (2020). How to beat science and influence people. *BJPS* 71(4). <https://arxiv.org/abs/1801.01239>
- Weatherall, J. O. & O'Connor, C. (2021). Conformity in scientific networks. *Synthese* 198. <https://arxiv.org/abs/1803.09905>
- Barrett, J. A., Skyrms, B. & Mohseni, A. (2019). Self-assembling networks. *BJPS* 70(1).
- Holman, B. & Bruner, J. P. (2015). The problem of intransigently biased agents. *Philosophy of Science* 82(5).
- Pozzi, M. (2025). From individual trust to collective knowledge: modeling epistemic vigilance. CIFMA 2025. <https://cifma.github.io/Papers-2025/S4-5-Pozzi.pdf>
- Weisberg, J. (2020). Blog series on the Zollman effect and polarization: <https://jonathanweisberg.org/post/zollman/>, code at <https://github.com/jweisber/sep-sen>
