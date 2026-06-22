const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const localEnvPath = path.join(__dirname, '.env');
const configPath = path.join(__dirname, 'deploy_config.json');

// config dosyasını kontrol et
if (!fs.existsSync(configPath)) {
  console.error('\x1b[31m%s\x1b[0m', 'HATA: deploy_config.json bulunamadı!');
  console.log('Lütfen ana dizinde deploy_config.json dosyasını oluşturun ve VPS bilgilerinizi girin.');
  process.exit(1);
}

let vpsList = [];
try {
  vpsList = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (error) {
  console.error('\x1b[31m%s\x1b[0m', 'HATA: deploy_config.json dosyası geçerli bir JSON değil!');
  process.exit(1);
}

// .env dosyasını kontrol et
if (!fs.existsSync(localEnvPath)) {
  console.error('\x1b[31m%s\x1b[0m', 'HATA: Ana dizinde .env dosyası bulunamadı!');
  process.exit(1);
}

console.log('\x1b[36m%s\x1b[0m', '=== DEPLOY SÜRECİ BAŞLADI ===');
console.log(`Yerel .env dosyası: ${localEnvPath}\n`);

vpsList.forEach((vps) => {
  console.log('\x1b[33m%s\x1b[0m', `[${vps.name || vps.host}] ${vps.user}@${vps.host}:${vps.port || 22} güncelleniyor...`);
  
  try {
    const keyOption = vps.keyPath ? `-i "${vps.keyPath}"` : '';
    const port = vps.port || 22;
    const portOptionScp = `-P ${port}`;
    const portOptionSsh = `-p ${port}`;

    // 1. .env Dosyasını SCP ile Gönder
    console.log(`  -> .env dosyası kopyalanıyor...`);
    const scpCmd = `scp ${keyOption} ${portOptionScp} "${localEnvPath}" ${vps.user}@${vps.host}:${vps.projectPath}/.env`;
    execSync(scpCmd, { stdio: 'inherit' });

    // 2. PM2 restart & reset komutunu çalıştır
    console.log(`  -> PM2 restart & reset yapılıyor...`);
    const sshCmd = `ssh ${keyOption} ${portOptionSsh} ${vps.user}@${vps.host} "cd ${vps.projectPath} && pm2 restart paypaylasim && pm2 reset paypaylasim"`;
    execSync(sshCmd, { stdio: 'inherit' });

    console.log('\x1b[32m%s\x1b[0m', `[${vps.name || vps.host}] BAŞARIYLA GÜNCELLENDİ VE RESTART EDİLDİ.\n`);
  } catch (error) {
    console.error('\x1b[31m%s\x1b[0m', `[${vps.name || vps.host}] güncellenirken HATA oluştu:`);
    console.error(error.message);
    console.log('');
  }
});

console.log('\x1b[36m%s\x1b[0m', '=== TÜM İŞLEMLER TAMAMLANDI ===');
