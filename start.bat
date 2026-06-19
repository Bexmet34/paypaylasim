@echo off
echo Gerekli bagimliliklar yukleniyor...
call npm install

echo PM2 kontrol ediliyor ve yukleniyor...
call npm install -g pm2

echo Komutlar Discord'a gonderiliyor...
call node src/utils/deployCommands.js

echo Bot PM2 uzerinden baslatiliyor...
:: Eger onceden calisiyorsa once durduruyoruz
call pm2 stop paypaylasim 2>nul
call pm2 start src/index.js --name "paypaylasim"

echo.
echo ====================================================================
echo Bot arka planda (PM2 ile) basariyla calisiyor!
echo Artik bu siyah ekrani KAPATSANIZ BILE botunuz 7/24 calismaya devam eder.
echo.
echo Botu tamamen durdurmak isterseniz yeni bir CMD acip sunu yazin:
echo pm2 stop paypaylasim
echo ====================================================================
echo.
echo Anlik loglari asagida gorebilirsiniz (Bu ekrani kapatmak botu etkilemez):
call pm2 logs paypaylasim
