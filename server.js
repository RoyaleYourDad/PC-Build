const express = require('express');
const cloudinary = require('cloudinary').v2;
const dotenv = require('dotenv');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const path = require('path');
const fetch = require('node-fetch').default; // Explicitly use default export for node-fetch v2
const fs = require('fs'); // Still needed for file cleanup
const multer = require('multer');

dotenv.config();
const app = express();

// URL for grok-server
const JSON_SERVER_URL = 'https://grok-server-production.up.railway.app/data';

// Fetch data from grok-server
async function fetchData() {
  try {
    const response = await fetch(JSON_SERVER_URL);
    if (!response.ok) throw new Error('Failed to fetch data from grok-server');
    return await response.json();
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error fetching data: ${error.message}`);
    return { users: [], parts: [] }; // Fallback to empty data
  }
}

// Save data to grok-server
async function saveData(data) {
  try {
    const response = await fetch(JSON_SERVER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error('Failed to save data to grok-server');
    return await response.json();
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error saving data: ${error.message}`);
    throw error;
  }
}

// Multer setup for file uploads with validation
const storage = multer.diskStorage({
  destination: 'uploads/',
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif'];
  if (!allowedTypes.includes(file.mimetype)) {
    return cb(new Error('Invalid file type. Only JPEG, PNG, and GIF are allowed.'), false);
  }
  cb(null, true);
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
}).fields([
  { name: 'thumbnail', maxCount: 1 },
  { name: 'previews', maxCount: 5 },
]);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  store: new FileStore({
    path: './sessions',
    ttl: 86400,
    retries: 0,
  }),
  secret: 'simple_secret',
  resave: false,
  saveUninitialized: false,
}));
app.set('view engine', 'ejs');

// Cloudinary Config
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Middleware to check if user is logged in
const authenticate = (req, res, next) => {
  if (!req.session.user) {
    console.log(`[${new Date().toISOString()}] Authentication failed: No user in session`);
    return res.redirect('/login?redirectReason=authFailed');
  }
  next();
};

// Middleware to check if the user owns the part
const authorizePartOwner = async (req, res, next) => {
  const partId = req.params.id;
  const data = await fetchData();
  const part = data.parts.find(p => p.id === partId);
  if (!part || part.userId !== req.session.user.id) {
    return res.status(403).send('Unauthorized');
  }
  next();
};

// Routes
app.get('/', async (req, res) => {
  try {
    const data = await fetchData();
    const populatedParts = data.parts.map(part => ({
      ...part,
      user: data.users.find(u => u.id === part.userId)?.name || 'Unknown',
    }));
    res.render('index', { parts: populatedParts, user: req.session.user || null });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error rendering index: ${error.message}`, {
      stack: error.stack,
      userId: req.session.user?.id || 'unknown',
    });
    res.status(500).send('Internal Server Error: Failed to render index page');
  }
});

app.get('/login', (req, res) => {
  const redirectReason = req.query.redirectReason;
  let message = null;
  if (redirectReason === 'authFailed') {
    message = 'Please log in to access that page.';
  }
  res.render('login', { message });
});

app.post('/login', async (req, res) => {
  const { name, birthdate } = req.body;
  
  if (!name || !birthdate) {
    return res.render('login', { message: 'Please provide both username and birthdate.' });
  }

  const data = await fetchData();
  let user = data.users.find(u => u.name === name && u.birthdate === birthdate);
  
  if (!user) {
    return res.render('login', { message: 'Invalid username or birthdate. Please try again.' });
  }
  
  req.session.user = user;
  console.log(`[${new Date().toISOString()}] User logged in:`, {
    userId: user.id,
    name: user.name,
    sessionId: req.session.id,
  });
  res.redirect('/');
});

app.get('/register', (req, res) => {
  res.render('register', { message: null });
});

app.post('/register', async (req, res) => {
  const { name, birthdate } = req.body;

  if (!name || !birthdate) {
    return res.render('register', { message: 'Please provide both username and birthdate.' });
  }

  const data = await fetchData();
  const existingUser = data.users.find(u => u.name === name && u.birthdate === birthdate);
  if (existingUser) {
    return res.render('register', { message: 'User already exists. Please log in instead.' });
  }

  const user = { id: Date.now().toString(), name, birthdate };
  data.users.push(user);
  await saveData(user); // Send only the new user

  req.session.user = user;
  console.log(`[${new Date().toISOString()}] User registered and logged in:`, {
    userId: user.id,
    name: user.name,
    sessionId: req.session.id,
  });
  res.redirect('/');
});

app.get('/create', authenticate, (req, res) => {
  try {
    res.render('create', { user: req.session.user });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error rendering create: ${error.message}`, {
      stack: error.stack,
      userId: req.session.user?.id || 'unknown',
    });
    res.status(500).send('Internal Server Error: Failed to render create page');
  }
});

app.get('/create-part', authenticate, (req, res) => {
  try {
    res.render('create-part', { user: req.session.user, error: null, formData: null });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error rendering create-part: ${error.message}`, {
      stack: error.stack,
      userId: req.session.user?.id || 'unknown',
    });
    res.status(500).send('Internal Server Error: Failed to render create-part page');
  }
});

app.post('/create-part', authenticate, (req, res, next) => {
  upload(req, res, async (err) => {
    if (err) {
      console.error(`[${new Date().toISOString()}] Multer Error: ${err.message}`, {
        userId: req.session.user.id,
        file: req.files?.thumbnail?.[0]?.originalname || 'No file',
      });
      return res.render('create-part', {
        user: req.session.user,
        error: err.message,
        formData: req.body,
      });
    }

    const { name, type, socket, price, hashtags, extraDetailsNames, extraDetailsValues } = req.body;
    let thumbnailUrl = null;
    let previewUrls = [];

    if (req.files['thumbnail']) {
      const filePath = req.files['thumbnail'][0].path;
      const fileStats = fs.statSync(filePath);
      if (fileStats.size === 0) {
        console.error(`[${new Date().toISOString()}] Thumbnail file is empty`, {
          userId: req.session.user.id,
          filePath,
        });
        fs.unlinkSync(filePath);
        return res.render('create-part', {
          user: req.session.user,
          error: 'The uploaded thumbnail file is empty. Please select a valid image.',
          formData: req.body,
        });
      }

      try {
        const result = await cloudinary.uploader.upload(filePath, {
          transformation: [{ width: 300, height: 200, crop: 'fill' }],
        });
        thumbnailUrl = result.secure_url;
        fs.unlinkSync(filePath);
      } catch (error) {
        console.error(`[${new Date().toISOString()}] Cloudinary Thumbnail Upload Error: ${error.message}`, {
          userId: req.session.user.id,
          filePath,
          stack: error.stack,
        });
        return res.render('create-part', {
          user: req.session.user,
          error: `Failed to upload thumbnail: ${error.message}`,
          formData: req.body,
        });
      }
    }

    if (req.files['previews']) {
      for (const file of req.files['previews']) {
        const filePath = file.path;
        const fileStats = fs.statSync(filePath);
        if (fileStats.size === 0) {
          console.error(`[${new Date().toISOString()}] Preview file is empty`, {
            userId: req.session.user.id,
            filePath,
          });
          fs.unlinkSync(filePath);
          return res.render('create-part', {
            user: req.session.user,
            error: 'One of the uploaded preview files is empty. Please select valid images.',
            formData: req.body,
          });
        }

        try {
          const result = await cloudinary.uploader.upload(filePath, {
            transformation: [{ width: 600, height: 400, crop: 'fill' }],
          });
          previewUrls.push(result.secure_url);
          fs.unlinkSync(filePath);
        } catch (error) {
          console.error(`[${new Date().toISOString()}] Cloudinary Preview Upload Error: ${error.message}`, {
            userId: req.session.user.id,
            filePath,
            stack: error.stack,
          });
          return res.render('create-part', {
            user: req.session.user,
            error: `Failed to upload preview image: ${error.message}`,
            formData: req.body,
          });
        }
      }
    }

    const extraDetails = [];
    if (extraDetailsNames && extraDetailsValues) {
      const names = Array.isArray(extraDetailsNames) ? extraDetailsNames : [extraDetailsNames];
      const values = Array.isArray(extraDetailsValues) ? extraDetailsValues : [extraDetailsValues];
      for (let i = 0; i < names.length; i++) {
        if (names[i] && values[i]) {
          extraDetails.push({ name: names[i], value: values[i] });
        }
      }
    }

    const part = {
      id: Date.now().toString(),
      userId: req.session.user.id,
      name,
      type,
      socket: type === 'cpu' ? socket : null,
      price: parseFloat(price) || 0,
      hashtags: hashtags ? hashtags.split(',').map(tag => tag.trim()) : [],
      thumbnail: thumbnailUrl,
      previews: previewUrls,
      extraDetails,
    };

    await saveData(part); // Send only the new part to grok-server
    res.redirect('/');
  });
});

app.get('/part/:id', async (req, res) => {
  try {
    const partId = req.params.id;
    const data = await fetchData();
    const part = data.parts.find(p => p.id === partId);
    if (!part) return res.status(404).send('Part not found');
    const populatedPart = {
      ...part,
      user: data.users.find(u => u.id === part.userId)?.name || 'Unknown',
    };
    res.render('part', { part: populatedPart, user: req.session.user || null });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error rendering part: ${error.message}`, {
      stack: error.stack,
      userId: req.session.user?.id || 'unknown',
    });
    res.status(500).send('Internal Server Error: Failed to render part page');
  }
});

app.get('/my-items', async (req, res) => {
  try {
    if (!req.session.user) {
      return res.render('my-items', { user: null, userItems: [] });
    }

    const data = await fetchData();
    const userItems = data.parts
      .filter(part => part.userId === req.session.user.id)
      .map(part => ({
        ...part,
        user: req.session.user.name,
      }));
    res.render('my-items', { user: req.session.user, userItems: userItems || [] });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error rendering my-items: ${error.message}`, {
      stack: error.stack,
      userId: req.session.user?.id || 'unknown',
    });
    res.status(500).send('Internal Server Error: Failed to render my-items page');
  }
});

app.get('/edit-part/:id', authenticate, authorizePartOwner, async (req, res) => {
  try {
    const partId = req.params.id;
    const data = await fetchData();
    const part = data.parts.find(p => p.id === partId);
    res.render('edit-part', { part, user: req.session.user, error: null });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error rendering edit-part: ${error.message}`, {
      stack: error.stack,
      userId: req.session.user?.id || 'unknown',
    });
    res.status(500).send('Internal Server Error: Failed to render edit-part page');
  }
});

app.post('/edit-part/:id', authenticate, authorizePartOwner, (req, res, next) => {
  upload(req, res, async (err) => {
    if (err) {
      console.error(`[${new Date().toISOString()}] Multer Error: ${err.message}`, {
        userId: req.session.user.id,
        file: req.files?.thumbnail?.[0]?.originalname || 'No file',
      });
      const data = await fetchData();
      const part = data.parts.find(p => p.id === req.params.id);
      return res.render('edit-part', {
        part,
        user: req.session.user,
        error: err.message,
      });
    }

    const partId = req.params.id;
    const { name, type, socket, price, hashtags, extraDetailsNames, extraDetailsValues } = req.body;

    const data = await fetchData();
    const partIndex = data.parts.findIndex(p => p.id === partId);
    let thumbnailUrl = data.parts[partIndex].thumbnail;
    let previewUrls = data.parts[partIndex].previews || [];

    if (req.files['thumbnail']) {
      const filePath = req.files['thumbnail'][0].path;
      const fileStats = fs.statSync(filePath);
      if (fileStats.size === 0) {
        console.error(`[${new Date().toISOString()}] Thumbnail file is empty`, {
          userId: req.session.user.id,
          filePath,
        });
        fs.unlinkSync(filePath);
        return res.render('edit-part', {
          part: data.parts[partIndex],
          user: req.session.user,
          error: 'The uploaded thumbnail file is empty. Please select a valid image.',
        });
      }

      try {
        const result = await cloudinary.uploader.upload(filePath, {
          transformation: [{ width: 300, height: 200, crop: 'fill' }],
        });
        thumbnailUrl = result.secure_url;
        fs.unlinkSync(filePath);
      } catch (error) {
        console.error(`[${new Date().toISOString()}] Cloudinary Thumbnail Upload Error: ${error.message}`, {
          userId: req.session.user.id,
          filePath,
          stack: error.stack,
        });
        return res.render('edit-part', {
          part: data.parts[partIndex],
          user: req.session.user,
          error: `Failed to upload thumbnail: ${error.message}`,
        });
      }
    }

    if (req.files['previews']) {
      previewUrls = [];
      for (const file of req.files['previews']) {
        const filePath = file.path;
        const fileStats = fs.statSync(filePath);
        if (fileStats.size === 0) {
          console.error(`[${new Date().toISOString()}] Preview file is empty`, {
            userId: req.session.user.id,
            filePath,
          });
          fs.unlinkSync(filePath);
          return res.render('edit-part', {
            part: data.parts[partIndex],
            user: req.session.user,
            error: 'One of the uploaded preview files is empty. Please select valid images.',
          });
        }

        try {
          const result = await cloudinary.uploader.upload(filePath, {
            transformation: [{ width: 600, height: 400, crop: 'fill' }],
          });
          previewUrls.push(result.secure_url);
          fs.unlinkSync(filePath);
        } catch (error) {
          console.error(`[${new Date().toISOString()}] Cloudinary Preview Upload Error: ${error.message}`, {
            userId: req.session.user.id,
            filePath,
            stack: error.stack,
          });
          return res.render('edit-part', {
            part: data.parts[partIndex],
            user: req.session.user,
            error: `Failed to upload preview image: ${error.message}`,
          });
        }
      }
    }

    const extraDetails = [];
    if (extraDetailsNames && extraDetailsValues) {
      const names = Array.isArray(extraDetailsNames) ? extraDetailsNames : [extraDetailsNames];
      const values = Array.isArray(extraDetailsValues) ? extraDetailsValues : [extraDetailsValues];
      for (let i = 0; i < names.length; i++) {
        if (names[i] && values[i]) {
          extraDetails.push({ name: names[i], value: values[i] });
        }
      }
    }

    const updatedPart = {
      ...data.parts[partIndex],
      name,
      type,
      socket: type === 'cpu' ? socket : null,
      price: parseFloat(price) || 0,
      hashtags: hashtags ? hashtags.split(',').map(tag => tag.trim()) : [],
      thumbnail: thumbnailUrl,
      previews: previewUrls,
      extraDetails,
    };

    await saveData(updatedPart); // Send only the updated part
    res.redirect('/my-items');
  });
});

app.get('/user/:id', authenticate, async (req, res) => {
  try {
    const userId = req.params.id;
    const data = await fetchData();
    const targetUser = data.users.find(u => u.id === userId);
    if (!targetUser) {
      console.log(`User with id ${userId} not found`);
      return res.status(404).send('User not found');
    }
    const userParts = data.parts.filter(part => part.userId === userId).map(part => ({
      ...part,
      user: data.users.find(u => u.id === part.userId)?.name || 'Unknown',
    }));
    res.render('user-parts', {
      user: req.session.user,
      targetUser,
      userParts,
    });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error rendering user parts: ${error.message}`, {
      stack: error.stack,
      userId: req.session.user?.id || 'unknown',
    });
    res.status(500).send('Internal Server Error: Failed to render user parts page');
  }
});

app.get('/users', authenticate, async (req, res) => {
  try {
    const data = await fetchData();
    const usersWithPartCount = data.users.map(user => {
      const partCount = data.parts.filter(part => part.userId === user.id).length;
      return { ...user, partCount };
    });
    res.render('users', { user: req.session.user, users: usersWithPartCount });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error rendering users: ${error.message}`, {
      stack: error.stack,
      userId: req.session.user?.id || 'unknown',
    });
    res.status(500).send('Internal Server Error: Failed to render users page');
  }
});

app.get('/hashtag/:tag', async (req, res) => {
  try {
    const tag = req.params.tag;
    const hashtag = `#${tag}`;
    const data = await fetchData();
    const filteredParts = data.parts
      .filter(part => part.hashtags.includes(hashtag))
      .map(part => ({
        ...part,
        user: data.users.find(u => u.id === part.userId)?.name || 'Unknown',
      }));
    res.render('hashtag', { parts: filteredParts, tag: hashtag, user: req.session.user || null });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error rendering hashtag: ${error.message}`, {
      stack: error.stack,
      userId: req.session.user?.id || 'unknown',
    });
    res.status(500).send('Internal Server Error: Failed to render hashtag page');
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));