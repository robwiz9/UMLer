---
name: uml-class-diagram-checker
description: Check, validate, review, and grade UML Class diagrams for UML 2.x syntactic correctness and object-oriented semantic quality. Use when the user uploads a UML Class diagram image, shares a Mermaid/PlantUML/text class diagram, or asks to review, critique, debug, or grade a conceptual domain model or design-level class diagram.
---
# UML Class Diagram Checker

Systematically audit UML Class diagrams for UML 2.x notation compliance, structural soundness, and object-oriented design fidelity against domain requirements.

## When to Use

- The user shares a UML Class diagram (image, PDF, Mermaid, PlantUML, or text description) and asks for a review, critique, or validation.
- The user asks to grade a student UML Class diagram or identify where points could be deducted.
- The user wants to catch syntactic errors (such as reversed inheritance arrows or invalid multiplicities) and semantic OO traps (such as double modeling, broken composition, or rigid role inheritance) before implementation.

## Steps

### 1. Establish Context and Abstraction Level

Before flagging errors, determine the modeling context from the diagram and prompt:

- **Abstraction level:** Identify whether the diagram is a **conceptual domain model** or a **design/implementation-level class diagram**. Conceptual models may omit visibility markers, data types, operations, and navigability arrows. Design-level models require visibility prefixes, parameter and return types, operations, and explicit stereotypes.
- **Domain requirements:** Check whether a problem statement or specification was provided. If no specification is given, evaluate against standard object-oriented and real-world conventions and state any assumptions explicitly.

### 2. Run Syntactic and UML 2.x Notation Checks

Inspect the diagram mechanics against UML 2.x rules:

- **Member syntax:** Verify attributes use `visibility name: Type` (for example, `- name: String`) and operations use `visibility method(param: Type): ReturnType` rather than programming-language order (`String name`).
- **Visibility, abstract, and static markers:** In design-level diagrams, check for visibility prefixes (`+`, `-`, `#`, `~`), italics or `{abstract}` for abstract classes and methods, and underlining for static members.
- **Arrowheads and line styles:** Verify exact UML connectors:
  - Generalization (inheritance): solid line with a closed hollow triangle pointing from subclass to superclass.
  - Interface realization: dashed line with a closed hollow triangle pointing from the implementing class to the interface.
  - Dependency: dashed line with an open arrowhead.
  - Association: solid line, with an open arrowhead only when unidirectional navigability is intended.
  - Aggregation and composition: hollow diamond (aggregation) or filled diamond (composition) placed on the whole (container) end, never the part end.
- **Multiplicities:** Confirm multiplicities are present, syntactically valid (`0..1`, `1`, `0..*`, `*`, `1..*`), and placed on the correct ends according to UML's look-across rule.
- **Naming and stereotypes:** Flag plural class names (`Students`), verb-named classes, or `snake_case` class names instead of singular `PascalCase` for classes and `camelCase` for attributes and operations. Check for missing `<<interface>>`, `<<enumeration>>`, or `<<abstract>>` stereotypes where needed.
- **Role labels:** Verify that recursive (self) associations and parallel associations between the same two classes include explicit role names so direction and meaning are unambiguous.

### 3. Run Semantic and Object-Oriented Design Checks

Evaluate whether the diagram accurately models the domain and follows sound OO principles:

- **Double modeling (foreign keys alongside associations):** Flag foreign key attributes (`customerId: int`) or duplicate reference fields (`customer: Customer`) written inside a class when an association line already connects the two classes.
- **Classes vs. instances:** Flag concrete objects (`HRDepartment`, `MainServer`, `JohnDoe`) modeled as classes instead of general types (`Department`, `Server`, `Employee`).
- **System, UI, or process classes:** Flag single-instance wrappers (`System`, `Database`), UI screens (`LoginPage`), or workflow steps (`ProcessPayment`, `SendEmail`) modeled as domain classes instead of persistent noun-based concepts.
- **Aggregation and composition misuse:** Check that composition (filled diamond) is used only for exclusive lifecycle ownership where the whole multiplicity is at most `1` (`1` or `0..1`). Flag composition when parts can outlive or be shared across multiple wholes, and flag unnecessary hollow-diamond aggregation where a plain association is cleaner.
- **Inheritance abuse:** Flag "has-a" relationships modeled as inheritance (such as `Car` inheriting from `Engine`), temporary or overlapping roles modeled as rigid subclasses (such as `Manager` and `Employee` under `Person` when one person can hold both roles or switch roles), duplicated inherited attributes/operations in subclasses, and cyclic inheritance.
- **Missing Association Classes:** Flag attributes that belong to a many-to-many link (such as `grade` between `Student` and `Course`) placed directly on one of the participating classes instead of in an Association Class connected via a dashed line.
- **Dependency vs. Association confusion:** Flag dashed dependency arrows used for long-lived stored fields, or solid associations used for transient method parameters.
- **Responsibility and clutter issues:** Flag God classes (`Manager` or `Controller` absorbing all behavior while other classes are anemic data bags) and excessive boilerplate getters/setters that obscure domain operations.
- **Mixed abstraction levels:** Flag domain models that mix business concepts (`Invoice`, `Customer`) with low-level technical classes (`SQLConnection`, `HashMap`, or database PK/FK tags).

### 4. Produce a Structured Audit Report

Present findings in a clear, actionable structure:

1. **Detected Context:** State the identified abstraction level (conceptual vs. design-level) and any domain assumptions.
2. **Critical Semantic and OO Design Errors:** List issues that violate OO principles or business rules (double modeling, broken composition multiplicity, wrong inheritance, missing association classes). For each, name the exact class or connector, explain why it fails, and give the concrete fix.
3. **Syntactic and Notation Issues:** List wrong arrowheads, reversed generalization or diamond placement, invalid member syntax, missing multiplicities or role labels, and naming violations with exact corrections.
4. **Minor Improvements and Ambiguities:** Note optional design refinements (such as removing unnecessary navigability arrows or boilerplate getters) and requirements needing clarification.
5. **Grading Summary (if requested):** When asked to grade, map each issue to clear deduction categories (OO Semantics and Design, Relationships and Multiplicities, Class Structure and Members, UML Notation and Clarity) and explain how to earn full marks.

## Gotchas

- **Respect the abstraction level:** Do not penalize a conceptual domain model for omitting visibility symbols, primitive types, operations, or navigability arrows. Apply full member-syntax rules only when the diagram is design-level or the rubric requires it.
- **Verify look-across multiplicities carefully:** In UML, the multiplicity near Class B specifies how many instances of B associate with one instance of A. Double-check both ends before declaring a multiplicity reversed.
- **Distinguish objective errors from domain assumptions:** When no problem statement is provided, separate strict UML violations (such as a composition whole with multiplicity `*` or a reversed generalization arrow) from assumption-dependent design choices (such as whether an `Order` can exist without a `Customer`).