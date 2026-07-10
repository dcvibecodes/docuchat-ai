const KnowledgeBase = require('../models/KnowledgeBase');
const Document = require('../models/Document');
const { NotFoundError, AuthorizationError } = require('../utils/errors');

class KnowledgeBaseController {
  static list(req, res, next) {
    try {
      const kbs = KnowledgeBase.findByUser(req.session.userId);
      res.json(kbs);
    } catch (err) {
      next(err);
    }
  }

  static create(req, res, next) {
    try {
      const { name, description } = req.body;
      const kb = KnowledgeBase.create({
        userId: req.session.userId,
        name,
        description
      });
      res.status(201).json(kb);
    } catch (err) {
      next(err);
    }
  }

  static get(req, res, next) {
    try {
      const kb = KnowledgeBase.findById(req.params.id);
      if (!kb) throw new NotFoundError('Knowledge base');
      if (kb.user_id !== req.session.userId) throw new AuthorizationError();

      const documents = Document.findByKnowledgeBase(kb.id);
      res.json({ ...kb, documents });
    } catch (err) {
      next(err);
    }
  }

  static update(req, res, next) {
    try {
      const kb = KnowledgeBase.findById(req.params.id);
      if (!kb) throw new NotFoundError('Knowledge base');
      if (kb.user_id !== req.session.userId) throw new AuthorizationError();

      const updated = KnowledgeBase.update(kb.id, {
        name: req.body.name,
        description: req.body.description
      });
      res.json(updated);
    } catch (err) {
      next(err);
    }
  }

  static delete(req, res, next) {
    try {
      const kb = KnowledgeBase.findById(req.params.id);
      if (!kb) throw new NotFoundError('Knowledge base');
      if (kb.user_id !== req.session.userId) throw new AuthorizationError();

      KnowledgeBase.delete(kb.id);
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = KnowledgeBaseController;
