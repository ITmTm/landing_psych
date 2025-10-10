const { src, dest, watch, parallel, series } = require('gulp');

const scss = require('gulp-sass')(require('sass')); //преобразование scss/sass в css
const concat = require('gulp-concat'); // объединение файлов
const uglify = require('gulp-uglify-es').default; //используется для минификации js
const browserSync = require('browser-sync').create(); // запускает локальный сервер
const autoprefixer = require('gulp-autoprefixer'); // приводит css к кроcсбраузерности
const clean = require('gulp-clean'); // удаление папок

const merge = require('merge-stream'); // одновременно запускать три "ветки" обработки
const svgmin = require('gulp-svgmin'); // оптимизация .svg

const avif = require('gulp-avif'); // конвертер в avif
const webp = require('gulp-webp'); // конвертер в webp
const imagemin = require('gulp-imagemin'); // сжимание картинок

const fs = require('fs');
const path = require('path'); // сжатие видео
const shell = require('gulp-shell');
const rename = require('gulp-rename');
const ffmpegPath = require('ffmpeg-static'); // путь к бинарнику ffmpeg

const newer = require('gulp-newer'); // кэш
const svgSprite = require('gulp-svg-sprite'); // объединение svg картинок в 1 файл
const include = require('gulp-include'); // подключение html к html
const typograf = require('gulp-typograf'); //расставляет неразрывные пробелы в нужных местах

function resources() {
    return src('app/upload/**/*')
        .pipe(dest('dist/upload'))
}

function pages() {
    return src('app/pages/*.html')
        .pipe(include({
            includePaths: 'app/components'
        }))
        .pipe(typograf({
            locale: ['ru', 'en-US'],
            safeTags: [
                ['<no-typography>', '</no-typography>']
            ]
        }))
        .pipe(dest('app'))
        .pipe(browserSync.stream())
}

// вспомогалки для вывода путей
function relOut(file, ext) {
    // из app/assets/video/src/foo/bar.mov -> app/assets/video/foo/bar.mp4
    const rel = path.relative(path.join(__dirname, 'app/assets/video/src'), file.path);
    return path.join('app/assets/video', rel).replace(path.extname(rel), ext);
}

/* MP4 (H.264) — быстрый пресет, хорошее качество/вес */
function videosMp4() {
    return src('app/assets/video/src/**/*.{mp4,mov,webm}')
        .pipe(newer({
            dest: 'app/assets/video',
            map: (p) => p.replace(/[/\\]src[/\\]/, path.sep).replace(/\.[^.]+$/, '.mp4')
        }))
        .pipe(shell([
            `"${ffmpegPath}" -y -i "<%= file.path %>" ` +
            `-c:v libx264 -crf 22 -preset veryfast -pix_fmt yuv420p -movflags +faststart ` +
            `-c:a aac -b:a 128k "<%= relOut(file, '.mp4') %>"`
        ], { templateData: { relOut } }));
}

/* WEBM (VP9+Opus) — ещё легче по весу, один проход */
function videosWebm() {
    return src('app/assets/video/src/**/*.{mp4,mov,webm}')
        .pipe(newer({
            dest: 'app/assets/video',
            map: (p) => p.replace(/[/\\]src[/\\]/, path.sep).replace(/\.[^.]+$/, '.webm')
        }))
        .pipe(shell([
            `"${ffmpegPath}" -y -i "<%= file.path %>" ` +
            `-c:v libvpx-vp9 -crf 34 -b:v 0 -row-mt 1 ` +
            `-c:a libopus -b:a 96k "<%= relOut(file, '.webm') %>"`
        ], { templateData: { relOut } }));
}

/* Постер для <video poster="..."> (кадр на 1-й секунде) */
function videoPosters() {
    return src('app/assets/video/src/**/*.{mp4,mov,webm}')
        .pipe(newer({
            dest: 'app/assets/video',
            map: (p) => p.replace(/[/\\]src[/\\]/, path.sep).replace(/\.[^.]+$/, '.jpg')
        }))
        .pipe(shell([
            `"${ffmpegPath}" -y -ss 1 -i "<%= file.path %>" -frames:v 1 -q:v 3 -update 1 ` +
            `"<%= relOut(file, '.jpg') %>"`
        ], { templateData: { relOut } }));
}

const videos = parallel(videosMp4, videosWebm, videoPosters);

    /*
        Если есть необходимость в модульности (Создание картинок по папкам с секциями)
    */
function images() {
    const srcPattern = [
        'app/images/src/**/*.*',    // все файлы во вложенных папках
        '!app/images/src/**/*.svg'  // кроме SVG
    ];
    const destPath = 'app/images';

    // AVIF
    const avifStream = src(srcPattern, { base: 'app/images/src' })
        .pipe(newer(destPath))
        .pipe(avif({ quality: 90 }))
        .pipe(dest(destPath));

    // WebP
    const webpStream = src(srcPattern, { base: 'app/images/src' })
        .pipe(newer(destPath))
        .pipe(webp())
        .pipe(dest(destPath));

    // Оригиналы (PNG/JPG/GIF) — оптимизация
    const imgStream = src(srcPattern, { base: 'app/images/src' })
        .pipe(newer(destPath))
        .pipe(imagemin({
            progressive: true,
            interlaced: true
            // при необходимости можно добавить плагины для конкретных форматов
        }))
        .pipe(dest(destPath));

    // Чистая оптимизация SVG
    const svgStream = src('app/images/src/**/*.svg', { base: 'app/images/src' })
        .pipe(newer(destPath))
        .pipe(svgmin())    // минимизация SVG
        .pipe(dest(destPath));

    // Объединение всех трех потоков и стримим в браузер
    return merge(avifStream, webpStream, imgStream, svgStream)
        .pipe(browserSync.stream());

}

function sprite() {
    return src('app/images/src/*.svg')
        .pipe(svgSprite({
            mode: {
                stack: {
                    sprite: '../sprite.svg',
                    example: true
                }
            }
        }))
        .pipe(dest('app/images/'))
}

function scripts() {
    const candidates = [
        'node_modules/jquery/dist/jquery.js',
        'node_modules/jquery-ui/dist/jquery-ui.js',
        'node_modules/swiper/swiper-bundle.js',

        'app/js/swiper-init.js', // инициализация свайпера
        'app/js/accordion.js', // аккордеоны
        'app/js/cookie.js', // уведомление о куки
        'app/js/menu.js', // меню хедера
        'app/js/header.js', // скролл для хедера
        'app/js/table.js', // таблица с табами
        'app/js/title.js', // установка title
        'app/js/up-btn.js', // кнопка наверх
        'app/js/main.js' // основной файл javascript
    ];

    const sources = candidates.filter(p => fs.existsSync(p));

    return src(sources, { allowEmpty: true }) // не ругайся, если какой-то файл пропал
        .pipe(concat('main.min.js'))
        .pipe(uglify({ compress: true, mangle: false }))
        .pipe(dest('app/js'))
        .pipe(browserSync.stream());
}

function styles() {
    return src('app/scss/style.scss')
        // с минификацией
        .pipe(scss({
            outputStyle: 'compressed'
        }))

        // без минификации
        // .pipe(scss({
        //     outputStyle: 'expanded'
        // }))

        .pipe(autoprefixer({ overrideBrowserslist: ['last 10 version'] }))
        .pipe(concat('style.min.css'))

        .pipe(dest('app/css'))
        .pipe(browserSync.stream())
}

function watching() {
    browserSync.init({
        server: {
            baseDir: 'app/'
        }
    });
    watch(['app/scss/**/*.scss'], styles);
    watch('app/images/src/**/*.*', images);    // было watch(['app/images/src'], images)
    watch(['app/js/main.js'], scripts);
    watch(['app/components/**/*.html', 'app/pages/**/*.html'], pages);
    watch(['app/*.html']).on('change', browserSync.reload);

    // ВИДЕО: пережимать при изменениях исходников
    watch(['app/assets/video/src/**/*.{mp4,mov,webm}'], series(videos, browserSync.reload));

    watch(['app/upload/**/*'], resources);
}

function cleanDist() {
    return src('dist')
        .pipe(clean())
}

function building() {
    return src([
        // 'app/css/style.min.css',
        'app/css/**/*.css',
        '!app/images/**/*.html',
        'app/images/*.*',
        // '!app/images/*.svg',
        // 'app/images/sprite.svg',
        'app/js/main.min.js',
        'app/*.html',
        'app/assets/**/*',
        "!app/assets/video/src{,/**}",

        'app/fonts/**/*',

        'app/upload/**/*'
    ], { base: 'app' })
        .pipe(dest('dist'))
}

exports.styles = styles;
exports.videos = videos;
exports.images = images;
exports.pages = pages;
exports.building = building;
exports.sprite = sprite;
exports.scripts = scripts;
exports.watching = watching;

exports.build = series(cleanDist, parallel(styles, scripts, images, videos, pages), building);
exports.default = series(styles, videos, images, scripts, pages, watching);