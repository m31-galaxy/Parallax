-- Parallax distillation harness — EXPERIMENT FIXTURE, NOT A SPEC PROPOSAL.
--
-- spec §12 leaves the v0.1 field-type set and the in-DB class-metadata
-- representation open. Nothing here is a decision; it exists to make the
-- distillation pipeline testable end to end.
--
-- Conventions that ARE decided (spec §4): PascalCase classes, snake_case fields.
-- Enforcement lives in the database (spec §3): SCHEMAFULL + ASSERT.

-- Built-in Note class (spec §5) --------------------------------------------
DEFINE TABLE Note SCHEMAFULL;
DEFINE FIELD created ON Note TYPE datetime DEFAULT time::now();
DEFINE FIELD content ON Note TYPE string ASSERT string::len($value) > 0;

-- User-defined demo classes -------------------------------------------------
DEFINE TABLE Person SCHEMAFULL;
DEFINE FIELD name    ON Person TYPE string ASSERT string::len($value) > 0;
DEFINE FIELD aliases ON Person TYPE array<string> DEFAULT [];
DEFINE INDEX person_name ON Person FIELDS name UNIQUE;

DEFINE TABLE Event SCHEMAFULL;
DEFINE FIELD name     ON Event TYPE string ASSERT string::len($value) > 0;
DEFINE FIELD location ON Event TYPE option<string>;
DEFINE FIELD time     ON Event TYPE option<string>;
DEFINE FIELD people   ON Event TYPE array<record<Person>> DEFAULT [];
DEFINE FIELD source   ON Event TYPE option<record<Note>>;

-- Review queue (spec §6: review before commit) ------------------------------
DEFINE TABLE Proposal SCHEMAFULL;
DEFINE FIELD note       ON Proposal TYPE record<Note>;
DEFINE FIELD class_name ON Proposal TYPE string
    ASSERT $value IN ["Person", "Event"];
DEFINE FIELD payload    ON Proposal TYPE object FLEXIBLE;
DEFINE FIELD confidence ON Proposal TYPE float
    ASSERT $value >= 0.0 AND $value <= 1.0;
DEFINE FIELD provenance ON Proposal TYPE object FLEXIBLE;
DEFINE FIELD status     ON Proposal TYPE string
    ASSERT $value IN ["pending", "approved", "rejected"] DEFAULT "pending";
DEFINE FIELD committed  ON Proposal TYPE option<record>;
