const express = require('express');
const router = express.Router();
const AuthController = require('../controllers/authController');
const { requireAuth } = require('../middleware/auth');
const { validateLogin } = require('../middleware/validate');

// Public: check if setup is needed
router.get('/needs-setup', AuthController.checkSetup);

// One-time admin setup (only works when no users exist)
router.post('/setup', AuthController.setup);

// Login/logout
router.post('/login', validateLogin, AuthController.login);
router.post('/logout', requireAuth, AuthController.logout);
router.get('/profile', requireAuth, AuthController.getProfile);

module.exports = router;
