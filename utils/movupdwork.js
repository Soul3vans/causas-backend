const puppeteer = require('puppeteer')
const random_useragent = require('random-useragent')

const td = async (options, frame) => {
  await frame.waitForSelector('#tribUno>select.comboBox')
  await frame.type('input[name="ROL_Causa"]', options.rol)
  await frame.type('input[name="ERA_Causa"]', options.era)
  await frame.select('#tribUno>select.comboBox', options.court)
  await frame.click('a[onclick="AtPublicoPpalForm.irAccionAtPublico.click();"]')
  await frame.waitForSelector('.textoC')
  const boton = await frame.$('table#contentCellsAddTabla tbody tr td.textoC a')
  const botonEnlace = await frame.evaluate(
    () =>
      document.querySelector('table#contentCellsAddTabla tbody tr td.textoC a')
        .href
  )
  await boton.click()

  await frame.waitForSelector('#divAnexoCau')

  const dt = await frame.evaluate(() => {
    const a = [...document.querySelectorAll('table')][2].innerText.split('\n')
    let c = []
    a.forEach(e => {
      c.push(e.split('\t'))
    })
    let crr = {}
    ;(crr['rol'] = c[0][0].split(':')[1]),
      (crr['cover'] = c[0][1]),
      (crr['admission'] = c[0][2].split(':')[1]),
      (crr['estAdmin'] = c[1][0].split(':')[1]),
      (crr['process'] = c[1][1].split(':')[1]),
      (crr['location'] = c[1][2].split(':')[1]),
      (crr['stage'] = c[2][0].split(':')[1]),
      (crr['processState'] = c[2][1].split(':')[1]),
      (crr['court'] = c[3][0].split(':')[1]),
      (crr['processState'] = c[2][1].split(':')[1]),
      (crr['status'] = crr['stage'].split(' ')[0] !== 8 ? 'ACTIVE' : 'CLOSED')
    return crr
  })

  const g = dt.admission.split('/')
  const parseDate = new Date(`${g[1]}/${g[0]}/${g[2]}`)
  dt.admission = parseDate

  // console.log(dt) guardar todos los datos de la causa

  const tlit = async params => {
    params.click !== null ? await frame.click(params.click) : ''
    await frame.waitForSelector(params.waitForSelector)
    await frame.waitForTimeout(params.waitForTimeout)

    return await frame.evaluate(({ waitForSelector }) => {
      const a = [
        ...document.querySelectorAll(`${waitForSelector} table`)
      ][1].innerText.split('\n')

      const b = [
        ...[...document.querySelectorAll('#Historia table')][1]
          .querySelector('tr tbody')
          .querySelectorAll('tr')
      ]

      let arr = []
      a.forEach((e, i) => {
        console.log('i ' + i)
        arr.push(e.split('\t'))
        if (waitForSelector === '#Historia') {
          let tdind = b[i].querySelectorAll('td')
          if (tdind[1].querySelector('img')) {
            arr[i][1] = `https://oficinajudicialvirtual.pjud.cl/${
              tdind[1]
                .querySelector('img')
                .getAttribute('onClick')
                .split('/')[2]
                .split("'")[0]
            }`
          } else {
            arr[i][1] = 'SD'
          }
        }
      })
      return arr
    }, params)
  }

  const rtht = await tlit({
    click: null,
    waitForSelector: '#Historia',
    waitForTimeout: 7500
  })
  const rtlit = await tlit({
    click: 'td#tdDos',
    waitForSelector: '#Litigantes',
    waitForTimeout: 1500
  })

  const artht = []
  const brtlit = []

  rtht.forEach(e => {
    j = e[6].trim().split('/')
    artht.push({
      invoice: e[0],
      document: e[1],
      annex: e[2],
      stage: e[3],
      procedure: e[4],
      descProcedure: e[5],
      dateProcedure: new Date(`${j[1]}/${j[0]}/${j[2]}`),
      page: e[7]
    })
  })

  rtlit.forEach(e => {
    if (e[0] === 'DDOR.' || e[0] === 'DDO.') {
      dt['debtor'] = e[3]
    }
    brtlit.push({
      participant: e[0],
      rut: e[1],
      person: e[2],
      name: e[3]
    })
  })

  dt['movementsHistory'] = artht
  dt['litigants'] = brtlit
  dt['extLink'] = botonEnlace

  console.log('----BE----')
  console.log(botonEnlace)
  console.log('----tht----')
  console.log(rtht)
  console.log('-----tlit----')
  console.log(rtlit)
  console.log('----DT----')
  console.log(dt)

  return {
    dt,
    botonEnlace,
    rtht,
    rtlit
  }
}

// export default ss = async () => {
const ss = async () => {
  const browser = await puppeteer.launch({ headless: false })
  const page = await browser.newPage()
  await page.goto('https://oficinajudicialvirtual.pjud.cl/', {
    // wait completed load
    waitUntil: 'load',
    // Remove the timeout
    timeout: 0
  })
  await page.setViewport({ width: 1200, height: 800 })
  await page.setUserAgent(
    random_useragent.getRandom(function (ua) {
      return (
        (ua.browserName === 'Chrome' || 'Firefox') &&
        parseFloat(ua.browserVersion) >= 40
      )
    })
  )
  // handle frame
  await page.waitForSelector('frame')

  const frames = await page.frames()
  const frame = frames.find(f => f.name().includes('body'))
  // filling form in iframe

  await td(
    {
      rol: '98',
      era: '2020',
      court: '158'
    },
    frame
  )

  // const logger = fs.createWriteStream('pru.txt', { flags: 'a' })
  // logger.write(`${dt}`)
  // logger.close()

  await page.waitForTimeout(3000)
  // await page.screenshot({ path: 'example.png' })

  await browser.close()
}

ss()
