module.exports = async (req, res) => {
  res.status(200).json({ ok: true, test: 'minimal handler' });
};
