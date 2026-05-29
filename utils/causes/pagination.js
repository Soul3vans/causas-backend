"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Pagination = void 0;
class Pagination {
    constructor(totalItem) {
        this.totalItem = totalItem;
        this.itemsPerPage = 15;
    }
    get pagesLength() {
        return Math.ceil(this.totalItem / this.itemsPerPage);
    }
    generate() {
        const totalPages = this.pagesLength;
        const pages = [];
        for (let i = 1; i <= totalPages; i++) {
            pages.push(i);
        }
        return pages;
    }
    static calculate(total) {
        return new Pagination(total).generate();
    }
}
exports.Pagination = Pagination;
