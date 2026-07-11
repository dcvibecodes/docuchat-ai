const Settings = require('../models/Settings');
const SystemConfig = require('../models/SystemConfig');

class SettingsController {
  static get(req, res, next) {
    try {
      let settings = Settings.findByUser(req.session.userId);
      if (!settings) {
        settings = Settings.createDefault(req.session.userId);
      }
      res.json(settings);
    } catch (err) {
      next(err);
    }
  }

  static update(req, res, next) {
    try {
      const updated = Settings.update(req.session.userId, { theme: req.body.theme });
      res.json(updated);
    } catch (err) {
      next(err);
    }
  }

  static getSuggestedPrompts(req, res, next) {
    try {
      const raw = SystemConfig.get('suggested_prompts');
      const prompts = raw ? JSON.parse(raw) : [];
      res.json(prompts);
    } catch (err) { next(err); }
  }
}

module.exports = SettingsController;
