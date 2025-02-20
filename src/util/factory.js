/* eslint no-constant-condition: "off" */

const d3 = require('d3')
const _ = {
  map: require('lodash/map'),
  uniqBy: require('lodash/uniqBy'),
  capitalize: require('lodash/capitalize'),
  each: require('lodash/each'),
}

const InputSanitizer = require('./inputSanitizer')
const Radar = require('../models/radar')
const Quadrant = require('../models/quadrant')
const Ring = require('../models/ring')
const Blip = require('../models/blip')
const GraphingRadar = require('../graphing/radar')
const QueryParams = require('./queryParamProcessor')
const MalformedDataError = require('../exceptions/malformedDataError')
const SheetNotFoundError = require('../exceptions/sheetNotFoundError')
const ContentValidator = require('./contentValidator')
const Sheet = require('./sheet')
const ExceptionMessages = require('./exceptionMessages')
const GoogleAuth = require('./googleAuth')
const config = require('../config')

const plotRadar = function (title, blips, currentRadarName, alternativeRadars) {
  if (title.endsWith('.csv')) {
    title = title.substring(0, title.length - 4)
  }
  if (title.endsWith('.json')) {
    title = title.substring(0, title.length - 5)
  }
  document.title = title
  d3.selectAll('.loading').remove()

  var rings = _.map(_.uniqBy(blips, 'ring'), 'ring')
  var ringMap = {}
  var maxRings = 4

  _.each(rings, function (ringName, i) {
    if (i === maxRings) {
      throw new MalformedDataError(ExceptionMessages.TOO_MANY_RINGS)
    }
    ringMap[ringName] = new Ring(ringName, i)
  })

  var quadrants = {}
  _.each(blips, function (blip) {
    if (!quadrants[blip.quadrant]) {
      quadrants[blip.quadrant] = new Quadrant(_.capitalize(blip.quadrant))
    }
    quadrants[blip.quadrant].add(
      new Blip(blip.name, ringMap[blip.ring], blip.isNew.toLowerCase() === 'true', blip.topic, blip.description),
    )
  })

  var radar = new Radar()
  _.each(quadrants, function (quadrant) {
    radar.addQuadrant(quadrant)
  })

  if (alternativeRadars !== undefined || true) {
    alternativeRadars.forEach(function (sheetName) {
      radar.addAlternative(sheetName)
    })
  }

  if (currentRadarName !== undefined || true) {
    radar.setCurrentSheet(currentRadarName)
  }

  var size = window.innerHeight - 133 < 620 ? 620 : window.innerHeight - 133

  new GraphingRadar(size, radar).init().plot()
}

const GoogleSheet = function (sheetReference, sheetName) {
  var self = {}

  self.build = function () {
    var sheet = new Sheet(sheetReference)
    sheet.validate(function (error, apiKeyEnabled) {
      if (error instanceof SheetNotFoundError) {
        plotErrorMessage(error)
        return
      }

      self.authenticate(false, apiKeyEnabled)
    })
  }

  function createBlipsForProtectedSheet(documentTitle, values, sheetNames) {
    if (!sheetName) {
      sheetName = sheetNames[0]
    }
    values.forEach(function () {
      var contentValidator = new ContentValidator(values[0])
      contentValidator.verifyContent()
      contentValidator.verifyHeaders()
    })

    const all = values
    const header = all.shift()
    var blips = _.map(all, (blip) => new InputSanitizer().sanitizeForProtectedSheet(blip, header))
    plotRadar(documentTitle + ' - ' + sheetName, blips, sheetName, sheetNames)
  }

  self.authenticate = function (force = false, apiKeyEnabled, callback) {
    if (!apiKeyEnabled) {
      GoogleAuth.loadGoogle(function () {
        GoogleAuth.login(() => {
          var sheet = new Sheet(sheetReference)
          sheet.processSheetResponse(sheetName, createBlipsForProtectedSheet, (error) => {
            if (error.status === 403) {
              plotUnauthorizedErrorMessage()
            } else {
              plotErrorMessage(error)
            }
          })
          if (callback) {
            callback()
          }
        }, force)
      })
    } else {
      GoogleAuth.loadGoogle(function () {
        var sheet = new Sheet(sheetReference)
        sheet.processSheetResponse(sheetName, createBlipsForProtectedSheet, (error) => {
          if (error.status === 403) {
            plotUnauthorizedErrorMessage()
          } else {
            plotErrorMessage(error)
          }
        })
        if (callback) {
          callback()
        }
      })
    }
  }

  self.init = function () {
    plotLoading()
    return self
  }

  return self
}

const CSVDocument = function (url) {
  var self = {}

  self.build = function () {
    d3.csv(url).then(createBlips)
  }

  var createBlips = function (data) {
    try {
      var columnNames = data.columns
      delete data.columns
      var contentValidator = new ContentValidator(columnNames)
      contentValidator.verifyContent()
      contentValidator.verifyHeaders()
      var blips = _.map(data, new InputSanitizer().sanitize)
      plotRadar(FileName(url), blips, 'CSV File', [])
    } catch (exception) {
      plotErrorMessage(exception)
    }
  }

  self.init = function () {
    plotLoading()
    return self
  }

  return self
}

const JSONFile = function (url) {
  var self = {}

  self.build = function () {
    d3.json(url).then(createBlips)
  }

  var createBlips = function (data) {
    try {
      var columnNames = Object.keys(data[0])
      var contentValidator = new ContentValidator(columnNames)
      contentValidator.verifyContent()
      contentValidator.verifyHeaders()
      var blips = _.map(data, new InputSanitizer().sanitize)
      plotRadar(FileName(url), blips, 'JSON File', [])
    } catch (exception) {
      plotErrorMessage(exception)
    }
  }

  self.init = function () {
    plotLoading()
    return self
  }

  return self
}

const DomainName = function (url) {
  var search = /.+:\/\/([^\\/]+)/
  var match = search.exec(decodeURIComponent(url.replace(/\+/g, ' ')))
  return match == null ? null : match[1]
}

const FileName = function (url) {
  var search = /([^\\/]+)$/
  var match = search.exec(decodeURIComponent(url.replace(/\+/g, ' ')))
  if (match != null) {
    var str = match[1]
    return str
  }
  return url
}

const GoogleSheetInput = function () {
  var self = {}
  var sheet

  self.build = function () {
    var domainName = DomainName(window.location.search.substring(1))
    var queryString = window.location.href.match(/sheetId(.*)/)
    var queryParams = queryString ? QueryParams(queryString[0]) : {}

    if (domainName && queryParams.sheetId.endsWith('.csv')) {
      sheet = CSVDocument(queryParams.sheetId)
      sheet.init().build()
    } else if (domainName && queryParams.sheetId.endsWith('.json')) {
      sheet = JSONFile(queryParams.sheetId)
      sheet.init().build()
    } else if (domainName && domainName.endsWith('google.com') && queryParams.sheetId) {
      sheet = GoogleSheet(queryParams.sheetId, queryParams.sheetName)
      console.log(queryParams.sheetName)

      sheet.init().build()
    } else {
      if (!config.featureToggles.UIRefresh2022) {
        document.body.innerHTML = ''
        const content = d3.select('body').append('div').attr('class', 'input-sheet')
        plotLogo(content)
        const bannerText =
          '<div><h1>Build your own radar</h1><p>Once you\'ve created your Radar, you can use this service' +
          ' to generate an <br />interactive version of your Technology Radar.</p></div>'

        plotBanner(content, bannerText)

        plotForm(content)

        plotFooter(content)
      }

      setDocumentTitle()
    }
  }

  return self
}

function setDocumentTitle() {
  document.title = 'Build your own Radar'
}

function plotLoading(content) {
  if (!config.featureToggles.UIRefresh2022) {
    document.body.innerHTML = ''
    content = d3.select('body').append('div').attr('class', 'loading').append('div').attr('class', 'input-sheet')

    setDocumentTitle()

    plotLogo(content)

    var bannerText =
      '<h1>Building your radar...</h1><p>Your Technology Radar will be available in just a few seconds</p>'
    plotBanner(content, bannerText)
    plotFooter(content)
  } else {
    document.querySelector('.helper-description > p').style.display = 'none'
    document.querySelector('.input-sheet-form').style.display = 'none'
    document.querySelector('.helper-description .loader-text').style.display = 'block'
  }
}

function plotLogo(content) {
  content
    .append('div')
    .attr('class', 'input-sheet__logo')
    .html('<a href="https://iagtech.com"><img src="/images/iag-logo.png" / ></a>')
}

function plotFooter(content) {
  content
    .append('div')
    .attr('id', 'footer')
    .append('div')
    .attr('class', 'footer-content')
    .append('p')
    .html(
      '',
    )
}

function plotBanner(content, text) {
  content.append('div').attr('class', 'input-sheet__banner').html(text)
}

function plotForm(content) {
  content
    .append('div')
    .attr('class', 'input-sheet__form')
    .append('p')
    .html(
      '<strong>Enter the URL of your CSV or JSON file below…</strong>',
    )

  var form = content.select('.input-sheet__form').append('form').attr('method', 'get')

  form
    .append('input')
    .attr('type', 'text')
    .attr('name', 'sheetId')
    .attr('placeholder', 'e.g. https://<URL>>hosted CSV/JSON file')
    .attr('required', '')

  form.append('button').attr('type', 'submit').append('a').attr('class', 'button').text('Build my radar')
}

function plotErrorMessage(exception) {
  if (config.featureToggles.UIRefresh2022) {
    showErrorMessage(exception)
  } else {
    const content = d3.select('body').append('div').attr('class', 'input-sheet')
    setDocumentTitle()

    plotLogo(content)

    const bannerText =
      '<div><h1>Build your own radar</h1><p>Once you\'ve created your Radar, you can use this service' +
      ' to generate an <br />interactive version of your Technology Radar.</p></div>'

    plotBanner(content, bannerText)

    d3.selectAll('.loading').remove()
    plotError(exception, content)

    plotFooter(content)
  }
}

function plotError(exception, container) {
  let message = "Oops! We can't find the data"
  let faqMessage =
    'Please check FAQs for possible solutions.'
  if (exception instanceof MalformedDataError) {
    message = message.concat(exception.message)
  } else if (exception instanceof SheetNotFoundError) {
    message = exception.message
  } else {
    console.error(exception)
  }
  container = container.append('div').attr('class', 'error-container')
  const errorContainer = container.append('div').attr('class', 'error-container__message')
  errorContainer.append('div').append('p').html(message)
  errorContainer.append('div').append('p').html(faqMessage)

  let homePageURL = window.location.protocol + '//' + window.location.hostname
  homePageURL += window.location.port === '' ? '' : ':' + window.location.port
  const homePage = '<a href=' + homePageURL + '>GO BACK</a>'

  errorContainer.append('div').append('p').html(homePage)
}

function showErrorMessage(exception) {
  document.querySelector('.helper-description .loader-text').style.display = 'none'
  const container = d3.select('main').append('div').attr('class', 'error-container')
  plotError(exception, container)
}

function plotUnauthorizedErrorMessage() {
  var content = d3.select('body').append('div').attr('class', 'input-sheet')
  setDocumentTitle()

  plotLogo(content)

  var bannerText = '<div><h1>Build your own radar</h1></div>'

  plotBanner(content, bannerText)

  d3.selectAll('.loading').remove()
  const currentUser = GoogleAuth.geEmail()
  let homePageURL = window.location.protocol + '//' + window.location.hostname
  homePageURL += window.location.port === '' ? '' : ':' + window.location.port
  const goBack = '<a href=' + homePageURL + '>GO BACK</a>'
  const message = `<strong>Oops!</strong> Looks like you are accessing this sheet using <b>${currentUser}</b>, which does not have permission.Try switching to another account.`

  const container = content.append('div').attr('class', 'error-container')

  const errorContainer = container.append('div').attr('class', 'error-container__message')

  errorContainer.append('div').append('p').attr('class', 'error-title').html(message)

  const button = errorContainer.append('button').attr('class', 'button switch-account-button').text('SWITCH ACCOUNT')

  errorContainer
    .append('div')
    .append('p')
    .attr('class', 'error-subtitle')
    .html(`or ${goBack} to try a different sheet.`)

  button.on('click', () => {
    var queryString = window.location.href.match(/sheetId(.*)/)
    var queryParams = queryString ? QueryParams(queryString[0]) : {}
    const sheet = GoogleSheet(queryParams.sheetId, queryParams.sheetName)
    sheet.authenticate(true, false, () => {
      content.remove()
    })
  })
}

module.exports = GoogleSheetInput
