require('./common')
require('./images/powered-logo.png')
require('./images/radar_legend.png')
require('./gtm.js')

const GoogleSheetInput = require('./util/factory')

GoogleSheetInput().build()
