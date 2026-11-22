---
name: er-diagram-checker
description: Check, validate, review, and grade Entity-Relationship (ER) diagrams for syntactic correctness and semantic fidelity. Use when the user uploads an ER diagram image, shares a Mermaid/PlantUML/text ERD, or asks to review, critique, debug, or grade a conceptual or logical database model.
---
# ER Diagram Checker

Systematically audit Entity-Relationship (ER) diagrams for notation compliance, structural soundness, and alignment with domain business rules.

## When to Use

- The user shares an ER diagram (image, PDF, Mermaid, PlantUML, or text description) and asks for a review, critique, or validation.
- The user asks to grade a student ER diagram or check where points might be deducted.
- The user wants to spot semantic traps (such as fan traps, chasm traps, or misplaced attributes) before converting an ERD into a relational schema.

## Steps

### 1. Establish Context and Modeling Level

Before flagging errors, determine three things from the diagram and prompt:

- **Notation:** Identify whether the diagram uses Chen, Crow's Foot (IE), UML, or Barker notation. Never penalize valid conventions of one notation using another notation's rules.
- **Abstraction level:** Determine if the model is **conceptual** or **logical**. In a conceptual ERD, raw M:N relationships are valid and foreign keys should be omitted. In a logical ERD, M:N relationships must be resolved into associative (junction) entities and foreign keys are expected.
- **Domain rules:** Check whether a problem statement or requirements text was provided. If no domain specification is given, evaluate against standard real-world conventions and explicitly state any assumptions made.

### 2. Run Syntactic and Notation Checks

Inspect the diagram mechanics for rule violations:

- **Notation consistency:** Flag mixed symbols (for example, Chen diamonds combined with Crow's Foot lines, or UML multiplicity mixed with Crow's Foot symbols).
- **Illegal connections:** In Chen notation, verify that entities do not connect directly to entities and relationships do not connect directly to relationships.
- **Primary keys and identifiers:** Confirm every strong entity has a clearly marked primary key and every weak entity has a partial key (discriminator) paired with an identifying relationship to its owner.
- **Attribute notation:** Check that multivalued, composite, and derived attributes use the correct symbols for the chosen notation rather than plain single-valued attributes when the domain requires them.
- **Naming conventions:** Flag plural entity names (use singular nouns like `Student`, not `Students`), verb-named entities, or vague relationship labels like `has` or `relates to` instead of descriptive active verbs. Flag unnamed relations, unless a relation attribute is linked to it (the relation attribute table name is used instead of the missing relation name)
- **Recursive role labels:** Verify that self-referencing relationships (such as `Employee` supervises `Employee`) include explicit role names on both ends so cardinality direction is unambiguous.

### 3. Run Semantic and Structural Checks

Evaluate whether the diagram accurately models the real-world domain without data loss or ambiguity:

- **Entity vs. attribute confusion:** Flag single-instance organization entities (like `University` or `Hospital` when the entire database represents that one organization), scalar values promoted to entities unnecessarily, or complex objects stuffed into a single text attribute.
- **Processes modeled as entities:** Flag workflow steps or UI actions (such as `Login`, `CheckStock`, or `SendEmail`) drawn as entities instead of persistent data.
- **Foreign keys in conceptual ERDs:** Flag foreign key attributes (such as `DeptID` inside `Employee`) in conceptual diagrams where the relationship line already represents the association.
- **Cardinality and participation errors:** Check every relationship in both directions for flipped 1:N sides and confused optionality vs. cardinality (for example, marking `Employee` mandatory in `Manages`, which implies every employee manages a department).
- **Misplaced relationship attributes:** Verify that attributes belonging to an M:N relationship (such as `Grade` on `Enrolls` or `Quantity` on `Contains`) are attached to the relationship or associative entity, not to one of the participating entities.
- **Fan traps:** Look for two 1:N relationships fanning out from a central entity (such as `Division` N:1 `Department` 1:N `Employee`) when the domain requires linking the two outer entities directly.
- **Chasm traps:** Look for optional participation in the middle of a relationship chain (such as `Branch` 1:N `Staff` 0..1:N `Property`) that breaks traceability between the outer entities when the middle link is null.
- **Redundant relationships:** Flag direct relationships between A and C that are already uniquely determined by A to B to C, unless the direct link encodes a distinct business rule.
- **Weak entity and ISA misuse:** Verify weak entities genuinely depend on an owner for identification. For ISA (specialization/generalization) hierarchies, check for duplicated superclass attributes in subclasses, missing disjointness (disjoint vs. overlapping) or completeness (total vs. partial) constraints, and subclasses with no distinct attributes or relationships.
- **Ternary decomposition errors:** Flag true three-way relationships (such as `Supplier` supplies `Part` to `Project`) wrongly split into binary relationships when the ternary link is needed to preserve which combination occurred.
- **Missing historical tracking:** Check whether requirements ask for history over time (past salaries, multiple bookings of the same room, previous managers). If so, a simple current-state relationship is insufficient and requires a timestamped associative entity.

### 4. Produce a Structured Audit Report

Present findings clearly so the user can act on them immediately:

1. **Detected Context:** State the identified notation, modeling level (conceptual vs. logical), and any assumptions made.
2. **Critical Semantic Errors:** List issues that break business rules, cause data loss, or create traps (fan/chasm traps, wrong cardinality, misplaced attributes). For each issue, state the exact element, why it fails, and the concrete fix.
3. **Syntactic and Notation Issues:** List notation mismatches, missing keys, missing role labels, or naming problems with specific corrections.
4. **Minor Improvements and Ambiguities:** Note optional refinements or requirements that need clarification from the domain owner.
5. **Grading Summary (if requested):** When asked to grade, map each error to a clear deduction category (Semantic Fidelity, Cardinality/Participation, Keys/Entities, Notation/Clarity) and explain how to recover full marks.

## Gotchas

- **Do not assume Crow's Foot rules for Chen diagrams:** Unresolved M:N relationships and omitted foreign keys are correct in conceptual Chen ERDs. Always check the abstraction level before flagging them.
- **Read cardinality from the right side of the line:** Different notations place cardinality symbols at opposite ends of a relationship (Chen vs. UML/Crow's Foot look-across vs. look-here conventions). Confirm the diagram's convention before calling a cardinality "reversed."
- **Separate confirmed errors from domain assumptions:** If the user did not supply a problem description, distinguish objective structural errors (like missing keys or unlabeled self-loops) from assumption-dependent critiques (like whether an employee can work in multiple departments).