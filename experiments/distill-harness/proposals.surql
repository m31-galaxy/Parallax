-- The review queue (spec section 6: review before commit).
--
-- Named to match the app's own `parallax_class` convention, and provisioned
-- idempotently the way src/lib/db/notes.ts provisions Note - so running the
-- distiller against a user's database never clobbers anything.
--
-- Deliberately NOT defined here: Person, Event, or any other class. Those are
-- the user's to create in the class designer; this file only adds the queue.

DEFINE TABLE IF NOT EXISTS parallax_proposal SCHEMAFULL;

-- The note this was extracted from, so every proposal is traceable.
DEFINE FIELD IF NOT EXISTS note ON parallax_proposal TYPE record<Note>;

-- The user class this proposes an object for. No ASSERT listing class names:
-- the whole point is that classes are the user's, not ours.
DEFINE FIELD IF NOT EXISTS class_name ON parallax_proposal TYPE string;

-- Extracted values, keyed by field name. FLEXIBLE because the shape is the
-- user's schema, which we cannot know in advance.
DEFINE FIELD IF NOT EXISTS payload ON parallax_proposal TYPE object FLEXIBLE;

-- Character offsets into Note.content per field, so a value can be traced back
-- to the exact span it came from.
DEFINE FIELD IF NOT EXISTS provenance ON parallax_proposal TYPE object FLEXIBLE;

-- Fields whose extracted text could not be coerced to the field's type
-- (e.g. "next Thursday" for a datetime). Kept for the user to fix rather than
-- silently dropped.
DEFINE FIELD IF NOT EXISTS unparsed ON parallax_proposal TYPE object FLEXIBLE;

DEFINE FIELD IF NOT EXISTS confidence ON parallax_proposal TYPE float
    ASSERT $value >= 0.0 AND $value <= 1.0;

DEFINE FIELD IF NOT EXISTS status ON parallax_proposal TYPE string
    ASSERT $value IN ["pending", "approved", "rejected"] DEFAULT "pending";

-- The object this became once approved.
DEFINE FIELD IF NOT EXISTS committed ON parallax_proposal TYPE option<record>;

DEFINE FIELD IF NOT EXISTS extractor ON parallax_proposal TYPE option<string>;
DEFINE FIELD IF NOT EXISTS created ON parallax_proposal TYPE datetime
    DEFAULT time::now() READONLY;
