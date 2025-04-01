const express = require('express');
const cloudinary = require('cloudinary').v2;
const dotenv = require('dotenv');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const path = require('path');
const fs = require('fs');
const multer = require('multer');

dotenv.config();
const app = express();

// File to store data
const DATA_FILE = 'data.json';

// Load data from file (or initialize if file doesn't exist or is invalid)
let users = [];
let parts = [];

if (fs.existsSync(DATA_FILE)) {
  try {
    const fileContent = fs.readFileSync(DATA_FILE, 'utf8');
    if (fileContent.trim() === '') {
      users = [];
      parts = [];
    } else {
      const data = JSON.parse(fileContent);
      users = data.users || [];
      parts = data.parts || [];
    }
  } catch (error) {
    console.error('Error parsing data.json:', error.message);
    users = [];
    parts = [];
    fs.writeFileSync(DATA_FILE, JSON.stringify({ users, parts }, null, 2), 'utf8');
  }
} else {
  fs.writeFileSync(DATA_FILE, JSON.stringify({ users: [], parts: [] }, null, 2), 'utf8');
}

// Function to save data to file
const saveData = () => {
  const data = { users, parts };
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
};

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
const authorizePartOwner = (req, res, next) => {
  const partId = req.params.id;
  const part = parts.find(p => p.id === partId);
  if (!part || part.userId !== req.session.user.id) {
    return res.status(403).send('Unauthorized');
  }
  next();
};

// Routes
app.get('/', (req, res) => {
  try {
    const populatedParts = parts.map(part => ({
      ...part,
      user: users.find(u => u.id === part.userId)?.name || 'Unknown',
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

app.post('/login', (req, res) => {
  const { name, birthdate } = req.body;
  
  // Validate inputs
  if (!name || !birthdate) {
    return res.render('login', { message: 'Please provide both username and birthdate.' });
  }

  // Find the user
  let user = users.find(u => u.name === name && u.birthdate === birthdate);
  
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

app.post('/register', (req, res) => {
  const { name, birthdate } = req.body;

  // Validate inputs
  if (!name || !birthdate) {
    return res.render('register', { message: 'Please provide both username and birthdate.' });
  }

  // Check if user already exists
  const existingUser = users.find(u => u.name === name && u.birthdate === birthdate);
  if (existingUser) {
    return res.render('register', { message: 'User already exists. Please log in instead.' });
  }

  // Create new user
  const user = { id: Date.now().toString(), name, birthdate };
  users.push(user);
  saveData();

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

    // Upload thumbnail
    if (req.files['thumbnail']) {
      const filePath = req.files['thumbnail'][0].path;
      const fileStats = fs.statSync(filePath);
      if (fileStats.size === 0) {
        console.error(`[${new Date().toISOString()}] Thumbnail file is empty`, {
          userId: req.session.user.id,
          filePath,
        });
        fs.unlinkSync(filePath); // Clean up empty file
        return res.render('create-part', {
          user: req.session.user,
          error: 'The uploaded thumbnail file is empty. Please select a valid image.',
          formData: req.body,
        });
      }

      try {
        const result = await cloudinary.uploader.upload(filePath, {
          transformation: [
            { width: 300, height: 200, crop: 'fill' },
          ],
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

    // Upload preview images
    if (req.files['previews']) {
      for (const file of req.files['previews']) {
        const filePath = file.path;
        const fileStats = fs.statSync(filePath);
        if (fileStats.size === 0) {
          console.error(`[${new Date().toISOString()}] Preview file is empty`, {
            userId: req.session.user.id,
            filePath,
          });
          fs.unlinkSync(filePath); // Clean up empty file
          return res.render('create-part', {
            user: req.session.user,
            error: 'One of the uploaded preview files is empty. Please select valid images.',
            formData: req.body,
          });
        }

        try {
          const result = await cloudinary.uploader.upload(filePath, {
            transformation: [
              { width: 600, height: 400, crop: 'fill' },
            ],
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

    // Process extra details
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
    parts.push(part);
    saveData();
    res.redirect('/');
  });
});

app.get('/part/:id', (req, res) => {
  try {
    const partId = req.params.id;
    const part = parts.find(p => p.id === partId);
    if (!part) return res.status(404).send('Part not found');
    const populatedPart = {
      ...part,
      user: users.find(u => u.id === part.userId)?.name || 'Unknown',
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

app.get('/my-items', (req, res) => {
  try {
    if (!req.session.user) {
      return res.render('my-items', { user: null, userItems: [] });
    }

    // Fetch items created by the logged-in user from the parts array
    const userItems = parts
      .filter(part => part.userId === req.session.user.id)
      .map(part => ({
        ...part,
        user: req.session.user.name, // Populate the user field for rendering
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

app.get('/edit-part/:id', authenticate, authorizePartOwner, (req, res) => {
  try {
    const partId = req.params.id;
    const part = parts.find(p => p.id === partId);
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
      const partId = req.params.id;
      const part = parts.find(p => p.id === partId);
      return res.render('edit-part', {
        part,
        user: req.session.user,
        error: err.message,
      });
    }

    const partId = req.params.id;
    const partIndex = parts.findIndex(p => p.id === partId);
    const { name, type, socket, price, hashtags, extraDetailsNames, extraDetailsValues } = req.body;

    let thumbnailUrl = parts[partIndex].thumbnail;
    let previewUrls = parts[partIndex].previews || [];

    // Upload new thumbnail if provided
    if (req.files['thumbnail']) {
      const filePath = req.files['thumbnail'][0].path;
      const fileStats = fs.statSync(filePath);
      if (fileStats.size === 0) {
        console.error(`[${new Date().toISOString()}] Thumbnail file is empty`, {
          userId: req.session.user.id,
          filePath,
        });
        fs.unlinkSync(filePath); // Clean up empty file
        return res.render('edit-part', {
          part: parts[partIndex],
          user: req.session.user,
          error: 'The uploaded thumbnail file is empty. Please select a valid image.',
        });
      }

      try {
        const result = await cloudinary.uploader.upload(filePath, {
          transformation: [
            { width: 300, height: 200, crop: 'fill' },
          ],
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
          part: parts[partIndex],
          user: req.session.user,
          error: `Failed to upload thumbnail: ${error.message}`,
        });
      }
    }

    // Upload new preview images if provided
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
          fs.unlinkSync(filePath); // Clean up empty file
          return res.render('edit-part', {
            part: parts[partIndex],
            user: req.session.user,
            error: 'One of the uploaded preview files is empty. Please select valid images.',
          });
        }

        try {
          const result = await cloudinary.uploader.upload(filePath, {
            transformation: [
              { width: 600, height: 400, crop: 'fill' },
            ],
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
            part: parts[partIndex],
            user: req.session.user,
            error: `Failed to upload preview image: ${error.message}`,
          });
        }
      }
    }

    // Process extra details
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

    // Update the part
    parts[partIndex] = {
      ...parts[partIndex],
      name,
      type,
      socket: type === 'cpu' ? socket : null,
      price: parseFloat(price) || 0,
      hashtags: hashtags ? hashtags.split(',').map(tag => tag.trim()) : [],
      thumbnail: thumbnailUrl,
      previews: previewUrls,
      extraDetails,
    };
    saveData();
    res.redirect('/my-items');
  });
});

app.get('/user/:id', authenticate, (req, res) => {
  try {
    const userId = req.params.id;
    console.log(`Requested userId: ${userId} (type: ${typeof userId})`);
    console.log('Users array:', users);
    const targetUser = users.find(u => {
      console.log(`Comparing user.id: ${u.id} (type: ${typeof u.id}) with userId: ${userId}`);
      return u.id === userId;
    });
    if (!targetUser) {
      console.log(`User with id ${userId} not found`);
      return res.status(404).send('User not found');
    }
    const userParts = parts.filter(part => part.userId === userId).map(part => ({
      ...part,
      user: users.find(u => u.id === part.userId)?.name || 'Unknown',
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

app.get('/users', authenticate, (req, res) => {
  try {
    // Calculate partCount for each user
    const usersWithPartCount = users.map(user => {
      console.log(`User ID: ${user.id} (type: ${typeof user.id})`);
      const partCount = parts.filter(part => {
        console.log(`Part userId: ${part.userId} (type: ${typeof part.userId})`);
        return part.userId === user.id;
      }).length;
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

app.get('/hashtag/:tag', (req, res) => {
  try {
    const tag = req.params.tag;
    const hashtag = `#${tag}`; // Add the # prefix to match the stored format
    const filteredParts = parts
      .filter(part => part.hashtags.includes(hashtag))
      .map(part => ({
        ...part,
        user: users.find(u => u.id === part.userId)?.name || 'Unknown',
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