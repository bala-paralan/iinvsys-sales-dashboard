'use strict';
const mongoose = require('mongoose');

/**
 * CoachingNote — a manager's private assessment of one of their people.
 *
 * Doc 1 IS-DIR-02: "Private — not visible to Rajan or IS Head."
 * Doc 2 SA-MGR-03: "Manager Note (Private)."
 *
 * The visibility rule is unlike every other rule in the system: readable by the author
 * and the author's ANCESTORS, never by the subject and never by peers — so a Director's
 * note about an executive is invisible to that executive's own Head.
 *
 * DELIBERATELY A SEPARATE COLLECTION, not an Activity variant. Folded into Activity, one
 * forgotten predicate on the Customer 360 timeline — which is rendered for the subject
 * themselves — would show an executive their own Director's private assessment of them.
 * A separate collection cannot leak through a query that does not name it.
 */
const CoachingNoteSchema = new mongoose.Schema({
  about:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  body:   { type: String, required: true, trim: true },
  /* Optional focus: a coaching note may be about one account rather than in general. */
  customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', default: null },
}, { timestamps: true });

CoachingNoteSchema.index({ about: 1, createdAt: -1 });
CoachingNoteSchema.index({ author: 1, createdAt: -1 });
CoachingNoteSchema.index({ customer: 1, createdAt: -1 });

CoachingNoteSchema.methods.toJSON = function() {
  const obj = this.toObject();
  delete obj.__v;
  return obj;
};

module.exports = mongoose.model('CoachingNote', CoachingNoteSchema);
