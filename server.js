const express = require('express');
const cloudinary = require('cloudinary').v2;
const dotenv = require('dotenv');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const path = require('path');
const fetch = require('node-fetch').default;
const fs = require('fs');
const multer = require('multer');

// Load environment variables
dotenv.config();
const app = express();

// Constants
const JSON_SERVER_URL = 'https://grok-server-production.up.railway.app/data';
const VALID_TYPES = [
  "CPU (Central Processing Unit)", "Motherboard", "RAM (Random Access Memory)",
  "GPU (Graphics Processing Unit) / Graphics Card", "SSD (Solid State Drive) / HDD (Hard Disk Drive)",
  "PSU (Power Supply Unit)", "Case", "CPU Cooler", "Case Fans", "Monitor",
  "Keyboard", "Mouse", "Speakers / Headphones", "Network Adapter (Ethernet/Wi-Fi)", "Other"
];
const PORT = process.env.PORT || 3000;

// Cloudinary configuration
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Data fetching function
async function fetchData() {
  try {
    const response = await fetch(JSON_SERVER_URL);
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Fetch failed: ${response.status} - ${errorText}`);
    }
    const data = await response.json();
    (`[${new Date().toISOString()}] Data fetched successfully: ${data.users.length} users, ${data.parts.length} parts`);
    return data;
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error fetching data: ${error.message}`);
    return { users: [], parts: [] }; // Fallback to empty data
  }
}

// Data saving function
async function saveData(data) {
  try {
    const response = await fetch(JSON_SERVER_URL, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to save data: ${response.status} - ${errorText}`);
    }
    const savedData = await response.json();
    (`[${new Date().toISOString()}] Data saved successfully`);
    return savedData;
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error saving data: ${error.message}`);
    throw error;
  }
}

// Multer configuration for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'uploads/';
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir); // Ensure uploads dir exists
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const filename = `${Date.now()}-${file.originalname}`;
    (`[${new Date().toISOString()}] Uploading file: ${filename}`);
    cb(null, filename);
  },
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif'];
  const isValid = allowedTypes.includes(file.mimetype);
  if (isValid) {
    cb(null, true);
  } else {
    (`[${new Date().toISOString()}] Invalid file type: ${file.mimetype}`);
    cb(new Error('Invalid file type. Only JPEG, PNG, and GIF allowed.'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
}).fields([
  { name: 'thumbnail', maxCount: 1 },
  { name: 'previews', maxCount: 5 }
]);

// Middleware setup
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  store: new FileStore({ path: './sessions', ttl: 86400, retries: 0 }), // 24-hour session storage
  secret: 'simple_secret', // Change this in production
  resave: false,
  saveUninitialized: false,
}));
app.set('view engine', 'ejs');

// Authentication middleware
const authenticate = (req, res, next) => {
  if (!req.session.user) {
    (`[${new Date().toISOString()}] Authentication failed: No user in session`);
    return res.redirect('/login?redirectReason=authFailed');
  }
  (`[${new Date().toISOString()}] Authenticated user: ${req.session.user.name}`);
  next();
};

// Authorization middleware for part ownership
const authorizePartOwner = async (req, res, next) => {
  const partId = req.params.id || req.params.partId;
  const data = await fetchData();
  const part = data.parts.find(p => p.id === partId);
  if (!part) {
    (`[${new Date().toISOString()}] Part not found: ${partId}`);
    return res.status(404).send('Part not found');
  }
  if (part.userId !== req.session.user.id) {
    (`[${new Date().toISOString()}] Unauthorized access to part ${partId} by user ${req.session.user.id}`);
    return res.status(403).send('Unauthorized');
  }
  next();
};

// Logging middleware
app.use((req, res, next) => {
  (`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// Routes
app.get('/', async (req, res) => {
  try {
    const data = await fetchData();
    let filteredParts = data.parts.filter(part => 
      part.isPublic || (req.session.user && part.userId === req.session.user.id)
    );

    const { search, type, minPrice, maxPrice, details, sort } = req.query;

    if (search) {
      const searchLower = search.toLowerCase();
      filteredParts = filteredParts.filter(part => 
        part.name.toLowerCase().includes(searchLower) ||
        (part.extraDetails && part.extraDetails.some(d => 
          d.name.toLowerCase().includes(searchLower) || d.value.toLowerCase().includes(searchLower)))
      );
      (`[${new Date().toISOString()}] Filtered by search: ${search}, ${filteredParts.length} parts`);
    }
    if (type) {
      filteredParts = filteredParts.filter(part => part.type === type);
      (`[${new Date().toISOString()}] Filtered by type: ${type}, ${filteredParts.length} parts`);
    }
    if (minPrice) {
      filteredParts = filteredParts.filter(part => part.price >= parseFloat(minPrice));
      (`[${new Date().toISOString()}] Filtered by minPrice: ${minPrice}, ${filteredParts.length} parts`);
    }
    if (maxPrice) {
      filteredParts = filteredParts.filter(part => part.price <= parseFloat(maxPrice));
      (`[${new Date().toISOString()}] Filtered by maxPrice: ${maxPrice}, ${filteredParts.length} parts`);
    }
    if (details) {
      const detailsLower = details.toLowerCase();
      filteredParts = filteredParts.filter(part => 
        part.extraDetails && part.extraDetails.some(d => 
          `${d.name} ${d.value}`.toLowerCase().includes(detailsLower)
        )
      );
      (`[${new Date().toISOString()}] Filtered by details: ${details}, ${filteredParts.length} parts`);
    }

    if (sort === 'price-asc') filteredParts.sort((a, b) => a.price - b.price);
    else if (sort === 'price-desc') filteredParts.sort((a, b) => b.price - a.price);
    else if (sort === 'name') filteredParts.sort((a, b) => a.name.localeCompare(b.name));
    (`[${new Date().toISOString()}] Sorted by: ${sort || 'none'}`);

    const populatedParts = filteredParts.map(part => ({
      ...part,
      user: data.users.find(u => u.id === part.userId)?.name || 'Unknown',
    }));

    res.render('index', { 
      parts: populatedParts, 
      user: req.session.user || null, 
      types: VALID_TYPES, 
      filters: req.query 
    });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error rendering index: ${error.message}`);
    res.status(500).send('Internal Server Error: Failed to render index page');
  }
});

app.get('/login', (req, res) => {
  const redirectReason = req.query.redirectReason;
  let message = redirectReason === 'authFailed' ? 'Please log in to access that page.' : null;
  res.render('login', { message });
});

app.post('/login', async (req, res) => {
  const { name, birthdate } = req.body;
  if (!name || !birthdate) {
    (`[${new Date().toISOString()}] Login failed: Missing name or birthdate`);
    return res.render('login', { message: 'Please provide both username and birthdate.' });
  }

  const data = await fetchData();
  let user = data.users.find(u => u.name === name && u.birthdate === birthdate);
  if (!user) {
    (`[${new Date().toISOString()}] Login failed: Invalid credentials for ${name}`);
    return res.render('login', { message: 'Invalid username or birthdate. Please try again.' });
  }

  req.session.user = user;
  (`[${new Date().toISOString()}] User logged in:`, { userId: user.id, name: user.name });
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
  try {
    await saveData(data);
    req.session.user = user;
    res.redirect('/');
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Register failed: ${error.message}`);
    res.render('register', { message: 'Failed to register user. Please try again.' });
  }
});

app.get('/create', authenticate, (req, res) => {
  res.render('create', { user: req.session.user });
});

app.get('/create-part', authenticate, (req, res) => {
  res.render('create-part', { 
    user: req.session.user, 
    error: null, 
    formData: null, 
    types: VALID_TYPES 
  });
});

app.post('/create-part', authenticate, upload, async (req, res) => {
  if (req.fileValidationError) {
    return res.render('create-part', { 
      user: req.session.user, 
      error: req.fileValidationError, 
      formData: req.body, 
      types: VALID_TYPES 
    });
  }

  const { name, type, socket, price, hashtags, isPublic, extraDetailsNames, extraDetailsValues } = req.body;
  let thumbnailUrl = null, previewUrls = [];

  if (req.files['thumbnail']) {
    try {
      const result = await cloudinary.uploader.upload(req.files['thumbnail'][0].path, { 
        transformation: [{ width: 300, height: 200, crop: 'fill' }] 
      });
      thumbnailUrl = result.secure_url;
      fs.unlinkSync(req.files['thumbnail'][0].path);
    } catch (error) {
      console.error(`[${new Date().toISOString()}] Cloudinary Thumbnail Upload Error: ${error.message}`);
      return res.render('create-part', { 
        user: req.session.user, 
        error: `Thumbnail upload failed: ${error.message}`, 
        formData: req.body, 
        types: VALID_TYPES 
      });
    }
  }

  if (req.files['previews']) {
    for (const file of req.files['previews']) {
      try {
        const result = await cloudinary.uploader.upload(file.path, { 
          transformation: [{ width: 600, height: 400, crop: 'fill' }] 
        });
        previewUrls.push(result.secure_url);
        fs.unlinkSync(file.path);
      } catch (error) {
        console.error(`[${new Date().toISOString()}] Cloudinary Preview Upload Error: ${error.message}`);
        return res.render('create-part', { 
          user: req.session.user, 
          error: `Preview upload failed: ${error.message}`, 
          formData: req.body, 
          types: VALID_TYPES 
        });
      }
    }
  }

  const extraDetails = [];
  if (extraDetailsNames && extraDetailsValues) {
    const names = Array.isArray(extraDetailsNames) ? extraDetailsNames : [extraDetailsNames];
    const values = Array.isArray(extraDetailsValues) ? extraDetailsValues : [extraDetailsValues];
    for (let i = 0; i < names.length; i++) {
      if (names[i] && values[i]) extraDetails.push({ name: names[i], value: values[i] });
    }
  }

  const part = {
    id: Date.now().toString(),
    userId: req.session.user.id,
    name,
    type,
    socket: type === "CPU (Central Processing Unit)" ? socket : null,
    price: parseFloat(price) || 0,
    hashtags: hashtags ? hashtags.split(',').map(tag => tag.trim()) : [],
    thumbnail: thumbnailUrl,
    previews: previewUrls,
    isPublic: isPublic === 'true',
    extraDetails,
    createdAt: new Date()
  };

  const data = await fetchData();
  data.parts.push(part);
  try {
    await saveData(data);
    res.redirect('/my-items');
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Failed to save part: ${error.message}`);
    res.render('create-part', { 
      user: req.session.user, 
      error: 'Failed to save part.', 
      formData: req.body, 
      types: VALID_TYPES 
    });
  }
});

app.get('/edit-part/:id', authenticate, authorizePartOwner, async (req, res) => {
  try {
    const partId = req.params.id;
    const data = await fetchData();
    const part = data.parts.find(p => p.id === partId);
    res.render('edit-part', { 
      part, 
      user: req.session.user, 
      error: null, 
      types: VALID_TYPES, 
      formData: part 
    });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error rendering edit-part: ${error.message}`);
    res.status(500).send('Internal Server Error');
  }
});

app.post('/edit-part/:id', authenticate, authorizePartOwner, upload, async (req, res) => {
  if (req.fileValidationError) {
    const data = await fetchData();
    const part = data.parts.find(p => p.id === req.params.id);
    return res.render('edit-part', { 
      part, 
      user: req.session.user, 
      error: req.fileValidationError, 
      types: VALID_TYPES, 
      formData: req.body 
    });
  }

  const partId = req.params.id;
  const { name, type, socket, price, hashtags, isPublic, extraDetailsNames, extraDetailsValues } = req.body;
  const data = await fetchData();
  const partIndex = data.parts.findIndex(p => p.id === partId);
  let thumbnailUrl = data.parts[partIndex].thumbnail, previewUrls = data.parts[partIndex].previews || [];

  if (req.files['thumbnail']) {
    try {
      const result = await cloudinary.uploader.upload(req.files['thumbnail'][0].path, { 
        transformation: [{ width: 300, height: 200, crop: 'fill' }] 
      });
      thumbnailUrl = result.secure_url;
      fs.unlinkSync(req.files['thumbnail'][0].path);
    } catch (error) {
      console.error(`[${new Date().toISOString()}] Cloudinary Thumbnail Upload Error: ${error.message}`);
      return res.render('edit-part', { 
        part: data.parts[partIndex], 
        user: req.session.user, 
        error: `Thumbnail upload failed: ${error.message}`, 
        types: VALID_TYPES, 
        formData: req.body 
      });
    }
  }

  if (req.files['previews']) {
    previewUrls = [];
    for (const file of req.files['previews']) {
      try {
        const result = await cloudinary.uploader.upload(file.path, { 
          transformation: [{ width: 600, height: 400, crop: 'fill' }] 
        });
        previewUrls.push(result.secure_url);
        fs.unlinkSync(file.path);
      } catch (error) {
        console.error(`[${new Date().toISOString()}] Cloudinary Preview Upload Error: ${error.message}`);
        return res.render('edit-part', { 
          part: data.parts[partIndex], 
          user: req.session.user, 
          error: `Preview upload failed: ${error.message}`, 
          types: VALID_TYPES, 
          formData: req.body 
        });
      }
    }
  }

  const extraDetails = [];
  if (extraDetailsNames && extraDetailsValues) {
    const names = Array.isArray(extraDetailsNames) ? extraDetailsNames : [extraDetailsNames];
    const values = Array.isArray(extraDetailsValues) ? extraDetailsValues : [extraDetailsValues];
    for (let i = 0; i < names.length; i++) {
      if (names[i] && values[i]) extraDetails.push({ name: names[i], value: values[i] });
    }
  }

  const updatedPart = {
    ...data.parts[partIndex],
    name,
    type,
    socket: type === "CPU (Central Processing Unit)" ? socket : null,
    price: parseFloat(price) || 0,
    hashtags: hashtags ? hashtags.split(',').map(tag => tag.trim()) : [],
    thumbnail: thumbnailUrl,
    previews: previewUrls,
    isPublic: isPublic === 'true',
    extraDetails,
    updatedAt: new Date()
  };

  data.parts[partIndex] = updatedPart;
  try {
    await saveData(data);
    res.redirect('/my-items');
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Failed to update part: ${error.message}`);
    res.render('edit-part', { 
      part: data.parts[partIndex], 
      user: req.session.user, 
      error: 'Failed to update part.', 
      types: VALID_TYPES, 
      formData: req.body 
    });
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
      .map(part => ({ ...part, user: req.session.user.name }));
    res.render('my-items', { user: req.session.user, userItems });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error rendering my-items: ${error.message}`);
    res.status(500).send('Internal Server Error');
  }
});

// Fixed /user/:userId route (removed duplicate)
app.get('/user/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;
    const data = await fetchData();
    const userData = data.users.find(u => u.id === userId);
    if (!userData) {
      return res.status(404).send('User not found');
    }

    const parts = data.parts
      .filter(part => part.userId === userId && (part.isPublic || (req.session.user && req.session.user.id === userId)))
      .map(part => ({ ...part, user: userData.name }));

    res.render('user-parts', {
      user: req.session.user, // Logged-in user
      userData: userData,     // User whose parts we're viewing
      parts: parts            // Their visible parts
    });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error rendering user-parts: ${error.message}`);
    res.status(500).send('Internal Server Error');
  }
});

// Added /part/:partId route
app.get('/part/:partId', async (req, res) => {
  try {
    const partId = req.params.partId;
    const data = await fetchData();
    const part = data.parts.find(p => p.id === partId);
    if (!part) {
      return res.status(404).send('Part not found');
    }

    // Check visibility: public or owned by logged-in user
    if (!part.isPublic && (!req.session.user || req.session.user.id !== part.userId)) {
      return res.status(403).send('Unauthorized');
    }

    const userName = data.users.find(u => u.id === part.userId)?.name || 'Unknown';
    const populatedPart = { ...part, user: userName };
    res.render('part', {
      user: req.session.user,
      part: populatedPart
    });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error rendering part: ${error.message}`);
    res.status(500).send('Internal Server Error');
  }
});

app.get('/users', authenticate, async (req, res) => {
  try {
    const data = await fetchData();
    const usersWithPartCount = data.users.map(user => ({
      ...user,
      partCount: data.parts.filter(part => part.userId === user.id).length,
    }));
    res.render('users', { user: req.session.user, users: usersWithPartCount });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error rendering users: ${error.message}`);
    res.status(500).send('Internal Server Error');
  }
});

app.get('/hashtag/:tag', async (req, res) => {
  try {
    const tag = req.params.tag;
    const hashtag = `#${tag}`;
    const data = await fetchData();
    const filteredParts = data.parts
      .filter(part => 
        part.hashtags && 
        part.hashtags.includes(hashtag) && 
        (part.isPublic || (req.session.user && part.userId === req.session.user.id))
      )
      .map(part => ({ 
        ...part, 
        user: data.users.find(u => u.id === part.userId)?.name || 'Unknown' 
      }));
    res.render('hashtag', { 
      parts: filteredParts, 
      tag: hashtag, 
      user: req.session.user || null 
    });
  } catch (error) {
    res.status(500).send('Internal Server Error');
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) console.error(`[${new Date().toISOString()}] Error destroying session: ${err.message}`);
    res.redirect('/');
  });
});

// Start server
app.listen(PORT, () => {
});