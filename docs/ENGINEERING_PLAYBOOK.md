# AI-Assisted Engineering Playbook

This playbook describes how to use AI as an implementation partner without
giving up responsibility for the system. The goal is not to memorize syntax or
manually write every line. The goal is to own the problem, architecture,
verification, and consequences of what gets built.

## The engineer's responsibility

AI may be faster at producing code, but the engineer remains responsible for:

- Defining the actual problem and deciding what is out of scope.
- Choosing boundaries between components and assigning responsibilities.
- Identifying assumptions, trust boundaries, and likely failure modes.
- Defining what observable evidence would demonstrate correctness.
- Reviewing real behavior rather than accepting "this should work."
- Understanding and communicating the important decisions.

A useful distinction is:

```text
Programming: How do I express this implementation?
Engineering: What should happen, what can fail, and what proves it works?
```

AI can take a large role in programming. It does not remove engineering
accountability.

## Work in bounded increments

Do not ask an agent to build an entire product in one unreviewed step. Divide the
system into increments that each prove one useful capability.

For every increment, use this sequence:

```text
Problem -> constraints -> design -> implementation -> verification -> explanation
```

Before implementation, answer:

1. What user-visible or system behavior are we adding?
2. What is the smallest increment that proves it?
3. What inputs and outputs cross the component boundary?
4. Who controls those inputs, and how are they validated?
5. What are the important success, failure, and edge cases?
6. What evidence will make the increment complete?

Do not expand scope merely because another feature is easy to generate.

## Define correctness before code

Write observable acceptance criteria before implementation. Include at least one
success case and one failure or edge case.

Prefer criteria such as:

```text
Given malformed tool input, execution is rejected before the tool runs.
Given multiple photos of one physical leaf, all photos enter the same data split.
Given the same random seed and source data, the generated manifest is identical.
```

Avoid criteria such as:

```text
The code looks correct.
The library should handle it.
The AI said the implementation is complete.
```

Acceptance criteria should be based on requirements, not reverse-engineered from
whatever code was generated.

## Understand architecture before syntax

For every important component, be able to explain three levels:

### Purpose

Why does this component exist? What responsibility does it own?

### Data flow

Trace one concrete request or data sample through its inputs, transformations,
dependencies, and outputs.

### Failure behavior

What malformed input, unavailable dependency, inconsistent state, or unsafe loop
could occur? Does the system reject, retry, degrade, or fail explicitly?

You do not need to recreate the implementation from an empty editor. You should
be able to read the important path, explain why its boundaries exist, and predict
its behavior on a concrete example.

## Treat boundaries as untrusted

The highest-risk code often sits where one system hands data to another:

- Model-generated tool calls
- HTTP requests and responses
- Database reads and writes
- Files and uploaded images
- External datasets
- Saved model artifacts
- Authentication and authorization
- Environment variables and credentials

At each boundary, ask:

```text
What enters?
Who controls it?
What format do we expect?
What validates the real runtime value?
What happens when it is missing, malformed, stale, or hostile?
```

Static types protect developers while building. Runtime validation protects the
running system from data that types cannot control.

## Verify at multiple layers

No single test proves an entire system.

### Static verification

Use compilers, strict type checking, linters, and schema validation to catch
structural mistakes early.

### Unit tests

Exercise isolated logic with small controlled examples. Include adversarial and
failure cases, not only the happy path.

### Integration tests

Exercise real boundaries such as APIs, datasets, model artifacts, databases, and
serialization formats. A mock proves local behavior against an assumed contract;
it does not prove that the external system actually matches that assumption.

### End-to-end tests

Run representative user workflows through the complete system.

### Manual evidence

Inspect metrics, logs, output files, rendered pages, screenshots, and failure
messages. Manually calculate a tiny expected result when possible.

Always report which layer was actually run. Never present a mocked round trip as
a live integration test.

## Make generated work prove itself

Useful questions to ask an AI implementation partner include:

- What assumptions did you make?
- What remains untested?
- Which behavior is mocked?
- What can make this fail in production?
- What official contract or documentation supports this usage?
- Show one malformed input and its observed failure.
- Show a deterministic rerun or independently calculated expected result.
- What is the simplest alternative architecture, and why was this chosen?

Require commands to run and outputs to be inspected. "Should work" is a proposal,
not verification evidence.

## Separate domain outcomes from system failures

An expected domain result is not the same as broken infrastructure.

```text
Crop not present in a small dataset
-> valid request, successful not-found result

Crop input is an integer instead of a string
-> invalid request, reject before execution

Crop data file cannot be read
-> system failure, report explicitly
```

Designing these categories clearly makes systems easier to test, debug, and
explain.

## Prefer constraints by construction

When possible, design data structures and flows that make invalid outcomes
impossible instead of cleaning them up afterward.

For example:

```text
Weak approach:
split individual images, detect leaf leakage, then discard collisions

Stronger approach:
make the physical leaf the indivisible unit of assignment
```

The stronger approach preserves data and prevents leakage by construction.

## Use measurements to justify complexity

Begin with the smallest well-understood baseline that can prove the end-to-end
system. Do not select a larger model, another framework, or a new service merely
because it might be more powerful.

Use this progression:

```text
working baseline
-> measured limitation
-> hypothesis about the limitation
-> bounded change
-> comparison using the same evaluation policy
```

Complexity should answer observed evidence.

## Preserve reproducibility and traceability

Record enough information to reproduce important artifacts:

- Source dataset and revision
- Generated split manifest
- Random seed
- Class mapping
- Model architecture and pretrained weights
- Image preprocessing
- Training settings
- Selected epoch and validation rule
- Final evaluation metrics
- Dependency versions

Prefer small inspectable manifests and configuration metadata over unexplained
folders of generated output.

## Keep an engineering decision log

Meaningful problems are valuable evidence of engineering ability. Record:

1. Intended behavior
2. Observed symptom
3. Investigation
4. Root cause
5. Decision or fix
6. Verification evidence
7. Remaining limitations
8. Interview-ready explanation

Focus on architectural, integration, data-quality, security, and debugging
lessons. Omit routine syntax mistakes and setup noise unless they reveal a larger
systemic issue.

## Use learning checkpoints

Do not move past a substantial increment until you can explain, in your own
words:

- What the component does
- Why it belongs where it does
- How data moves through it
- What important decision was made
- What can fail
- What was actually verified
- What remains limited

This is not a memorization test. Revisit concrete examples until the reasoning is
clear. Repeating the same framework across components gradually builds independent
engineering judgment.

## Practical AI collaboration loop

Use this workflow with an AI coding agent:

```text
1. State the desired behavior and constraints.
2. Agree on observable acceptance criteria.
3. Review the proposed architecture and tradeoffs.
4. Let the agent implement one bounded increment.
5. Run static, unit, integration, and manual checks as appropriate.
6. Exercise at least one success and one failure case.
7. Record assumptions, evidence, and remaining risks.
8. Explain the architecture back in your own words.
9. Clarify weak areas before continuing.
10. Commit the working increment.
```

## Interview framing

Do not claim that AI wrote the project and therefore the details do not matter.
Do not pretend that no AI assistance was used if asked directly.

A strong explanation is:

> I used AI to accelerate implementation, but I retained ownership of scope,
> architecture, acceptance criteria, and verification. I required real integration
> evidence beyond mocks, documented failures and tradeoffs, and worked through
> each important component until I could explain its purpose, data flow, and
> failure behavior.

The standard is not whether every character was typed manually. The standard is
whether you can defend what was built and produce credible evidence that it works.
