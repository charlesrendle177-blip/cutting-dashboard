const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  // Get Supabase credentials from environment variables
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return res.status(400).json({
      error: 'Supabase credentials not configured',
      message: 'Please set SUPABASE_URL and SUPABASE_ANON_KEY environment variables'
    });
  }

  try {
    // Initialize Supabase client
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    // Fetch all data from Supabase
    const { data: allData, error } = await supabase
      .from('cutting_logs')
      .select('*')
      .order('date', { ascending: true });

    if (error) {
      console.error('Supabase error:', error);
      return res.status(500).json({ error: error.message });
    }

    // If no data, use empty array
    const data = allData || [];

    // Calculate 7-day rolling average
    const calculate7DayRollingAverage = (data) => {
      const rolling = [];
      for (let i = 6; i < data.length; i++) {
        const window = data.slice(i - 6, i + 1);
        const avg = window.reduce((sum, d) => sum + d.weight, 0) / window.length;
        rolling.push({ date: data[i].date, avg: parseFloat(avg.toFixed(2)) });
      }
      return rolling;
    };

    const rolling = calculate7DayRollingAverage(data);

    // Get last 14 days
    const last14 = data.slice(-14);

    // Get latest entry
    const latest = data[data.length - 1];

    // Calculate stats
    const last7 = data.slice(-7);
    const avgSleep = last7.filter(d => d.sleep).length > 0
      ? parseFloat((last7.filter(d => d.sleep).reduce((sum, d) => sum + d.sleep, 0) / last7.filter(d => d.sleep).length).toFixed(1))
      : null;
    const avgSteps = last7.filter(d => d.steps).length > 0
      ? Math.round(last7.filter(d => d.steps).reduce((sum, d) => sum + d.steps, 0) / last7.filter(d => d.steps).length)
      : null;
    const avgCalories = last7.filter(d => d.calories).length > 0
      ? Math.round(last7.filter(d => d.calories).reduce((sum, d) => sum + d.calories, 0) / last7.filter(d => d.calories).length)
      : null;

    // Return clean JSON
    return res.status(200).json({
      success: true,
      timestamp: new Date().toISOString(),
      latest: latest ? {
        date: latest.date,
        weight: latest.weight,
        sleep: latest.sleep,
        steps: latest.steps,
        calories: latest.calories,
        workout: latest.workout,
        cardio: latest.cardio,
        notes: latest.notes
      } : null,
      last14Days: last14,
      rollingAverage7Day: rolling,
      stats: {
        avgSleep,
        avgSteps,
        avgCalories
      },
      totalEntries: data.length
    });
  } catch (err) {
    console.error('Error:', err);
    return res.status(500).json({ error: err.message });
  }
};
